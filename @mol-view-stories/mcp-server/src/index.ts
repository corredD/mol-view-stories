#!/usr/bin/env node
/**
 * mvs-mcp - MCP server for driving a locally running mol-view-stories editor.
 *
 * Talks to the dev API installed by webapp-patch (at MVS_DEV_URL,
 * default http://localhost:3000). All tools are thin wrappers around HTTP
 * calls; the real work happens in the webapp's API routes where the real
 * MolViewSpec builder lives.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';

const BASE = process.env.MVS_DEV_URL ?? 'http://localhost:3000';
const ENV_TOKEN = process.env.MVS_DEV_TOKEN ?? '';

// Session-scoped bearer token, settable from Claude via the `auth_set` tool.
// Preferred over MVS_DEV_TOKEN env when set. Lives only in this process's
// memory — never written to disk, never persisted across MCP restarts.
let sessionToken: string | null = null;

// --------------------- HTTP helpers ---------------------

async function api<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const url = `${BASE}${pathname}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  const token = sessionToken ?? ENV_TOKEN;
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${url} -> ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

const j = (obj: unknown) => JSON.stringify(obj, null, 2);

// --------------------- Tool definitions ---------------------

interface ToolDef<TInput extends z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>) => Promise<string>;
}

const tools: ToolDef<z.ZodTypeAny>[] = [];

function defineTool<TInput extends z.ZodTypeAny>(t: ToolDef<TInput>): void {
  tools.push(t as unknown as ToolDef<z.ZodTypeAny>);
}

// ---- Auth (session-scoped) ----

defineTool({
  name: 'auth_set',
  description:
    "Store a bearer token for the rest of this MCP session. Call this once when the user pastes a token from the mol-view-stories 'Start MCP' button. Every subsequent tool call will use this token to identify the user's editing slot on the server. Re-call to refresh after expiry.",
  inputSchema: z.object({
    token: z.string().min(1).describe('The token string from the Start MCP modal in the webapp.'),
  }),
  async handler({ token }) {
    sessionToken = token.trim();
    // Verify it works (and tell the caller who they are) by hitting /whoami.
    try {
      const who = await api<{ sub: string; name?: string; preferred_username?: string }>('/api/dev/whoami');
      return j({
        ok: true,
        authed_as: who.preferred_username ?? who.name ?? who.sub,
      });
    } catch (err) {
      sessionToken = null;
      return j({ ok: false, error: (err as Error).message });
    }
  },
});

defineTool({
  name: 'auth_status',
  description:
    'Report whether the MCP currently has a valid token and, if so, who it identifies. Use this if a previous tool call failed with 401 to confirm the user needs to paste a fresh token.',
  inputSchema: z.object({}),
  async handler() {
    if (!sessionToken && !ENV_TOKEN) {
      return j({ ok: false, error: 'no token set — call auth_set with a token from the webapp' });
    }
    try {
      const who = await api<{ sub: string; name?: string; preferred_username?: string }>('/api/dev/whoami');
      return j({
        ok: true,
        authed_as: who.preferred_username ?? who.name ?? who.sub,
        source: sessionToken ? 'session' : 'env',
      });
    } catch (err) {
      return j({ ok: false, error: (err as Error).message });
    }
  },
});

// ---- Story-level ----

defineTool({
  name: 'story_get',
  description:
    'Return the current story: title, author_note, settings, story-wide JS, and scene list. Always start a session with this so you know what scenes already exist.',
  inputSchema: z.object({}),
  async handler() {
    return j(await api('/api/dev/story'));
  },
});

defineTool({
  name: 'story_set_metadata',
  description:
    'Patch story-level metadata: title, author_note, settings (autoPlay, loopStory, showControls), and the story-wide JS block that defines helpers shared across all scenes.',
  inputSchema: z.object({
    title: z.string().optional(),
    author_note: z.string().optional(),
    story_js: z
      .string()
      .optional()
      .describe(
        'Story-wide JavaScript shared by all scenes. Define helper functions, constants, color palettes, transformation matrices. In scope: builder, Vec3, Mat4, Mat3, Quat, MS, decodeColor.'
      ),
    settings: z
      .object({
        autoPlay: z.boolean().optional(),
        loopStory: z.boolean().optional(),
        showControls: z.boolean().optional(),
      })
      .optional(),
  }),
  async handler(input) {
    return j(await api('/api/dev/story', { method: 'PATCH', body: JSON.stringify(input) }));
  },
});

// ---- Scene-level ----

defineTool({
  name: 'scenes_list',
  description: 'List scene keys, names, and timing in order.',
  inputSchema: z.object({}),
  async handler() {
    return j(await api('/api/dev/scenes'));
  },
});

defineTool({
  name: 'scene_get',
  description: 'Return a single scene by key: name, markdown description, JS body, and timing.',
  inputSchema: z.object({
    key: z.string().describe('Scene key as set when the scene was created.'),
  }),
  async handler({ key }) {
    return j(await api(`/api/dev/scene/${encodeURIComponent(key)}`));
  },
});

defineTool({
  name: 'scene_create',
  description:
    'Create a new scene. Returns the created scene. Fails if the key already exists; use scene_set to update instead.',
  inputSchema: z.object({
    key: z
      .string()
      .describe(
        'Stable identifier for the scene. Used by snapshot_key for clickable navigation between scenes, and by markdown [text](#key) links.'
      ),
    name: z.string().describe('Human-readable scene title.'),
    description: z.string().optional().describe('Markdown narration for the scene panel.'),
    javascript: z.string().optional().describe('Scene JS body that builds the MVS tree.'),
    linger_duration_ms: z.number().int().nonnegative().optional(),
    transition_duration_ms: z.number().int().nonnegative().optional(),
  }),
  async handler(input) {
    return j(await api('/api/dev/scenes', { method: 'POST', body: JSON.stringify(input) }));
  },
});

defineTool({
  name: 'scene_set',
  description:
    'Update a scene. Any field not provided is left unchanged. Use this to edit markdown, JS, or timing without recreating the scene.',
  inputSchema: z.object({
    key: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    javascript: z.string().optional(),
    linger_duration_ms: z.number().int().nonnegative().optional(),
    transition_duration_ms: z.number().int().nonnegative().optional(),
  }),
  async handler({ key, ...rest }) {
    return j(
      await api(`/api/dev/scene/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify(rest),
      })
    );
  },
});

defineTool({
  name: 'scene_delete',
  description: 'Delete a scene by key.',
  inputSchema: z.object({ key: z.string() }),
  async handler({ key }) {
    return j(await api(`/api/dev/scene/${encodeURIComponent(key)}`, { method: 'DELETE' }));
  },
});

defineTool({
  name: 'scenes_reorder',
  description:
    'Reorder scenes by passing the full list of keys in the new order. Missing keys are removed from the story; extra keys are ignored.',
  inputSchema: z.object({ order: z.array(z.string()) }),
  async handler(input) {
    return j(await api('/api/dev/scenes', { method: 'PATCH', body: JSON.stringify(input) }));
  },
});

// ---- Validation ----

defineTool({
  name: 'scene_validate',
  description:
    "Execute a scene's JS against a real MVS builder server-side and return either the resulting MVSJ snapshot or a structured error with line numbers. Use this to verify a scene compiles before asking the user to look at it. You can pass scene_js inline (preview without saving), or pass key alone to validate the saved scene.",
  inputSchema: z
    .object({
      key: z.string().optional(),
      scene_js: z.string().optional(),
      story_js: z.string().optional(),
    })
    .refine((v) => v.key || v.scene_js, {
      message: 'Provide either key or scene_js',
    }),
  async handler({ key, scene_js, story_js }) {
    let js = scene_js;
    let sjs = story_js;
    if (!js && key) {
      const sc = await api<{ javascript: string }>(`/api/dev/scene/${encodeURIComponent(key)}`);
      js = sc.javascript;
    }
    if (sjs === undefined) {
      const story = await api<{ story_js: string }>('/api/dev/story');
      sjs = story.story_js;
    }
    return j(
      await api('/api/dev/validate', {
        method: 'POST',
        body: JSON.stringify({ story_js: sjs, scene_js: js }),
      })
    );
  },
});

// ---- Builder introspection ----

defineTool({
  name: 'builder_list_methods',
  description:
    'Introspect the real MVS builder at runtime and return what methods exist on each node type (root, structure, component, representation, volume, primitives, structure_primitives, animation). Use this BEFORE writing builder code so you never guess at a method name. Pass node to narrow to one type; pass node and method to get a function signature.',
  inputSchema: z.object({
    node: z
      .enum([
        'root',
        'structure',
        'component',
        'representation',
        'volume',
        'primitives',
        'structure_primitives',
        'animation',
      ])
      .optional(),
    method: z.string().optional(),
  }),
  async handler({ node, method }) {
    const qs: string[] = [];
    if (node) qs.push(`node=${encodeURIComponent(node)}`);
    if (method) qs.push(`method=${encodeURIComponent(method)}`);
    const path = '/api/dev/builder' + (qs.length ? `?${qs.join('&')}` : '');
    return j(await api(path));
  },
});

// ---- Reference (types / docs / examples) ----

defineTool({
  name: 'mvs_types_get',
  description:
    'Return the full MVSTypes TypeScript declarations — the same .d.ts Monaco IntelliSense uses in the editor. Authoritative for builder method signatures, parameter shapes, and JSDoc. Pass node to narrow to one class block (root, structure, component, representation, volume, primitives, animation). Without node, returns the entire file (~140 KB). Use this BEFORE writing builder code; pair with builder_list_methods to discover method names, then read here for exact signatures.',
  inputSchema: z.object({
    node: z
      .enum(['root', 'structure', 'component', 'representation', 'volume', 'primitives', 'animation'])
      .optional()
      .describe('If given, return only the declare class <Name> block for that node.'),
  }),
  async handler({ node }) {
    const qs = node ? `?node=${encodeURIComponent(node)}` : '';
    return j(await api(`/api/dev/mvs-types${qs}`));
  },
});

defineTool({
  name: 'mvs_doc_list',
  description:
    'List the curated MolViewSpec concept primers available via mvs_doc_get. Covers selectors, primitives, volumes, animations, annotations, camera, the spec overview, etc. Use this when you need to understand a concept (not just a method signature) before writing scene JS.',
  inputSchema: z.object({}),
  async handler() {
    return j(await api('/api/dev/docs'));
  },
});

defineTool({
  name: 'mvs_doc_get',
  description:
    'Return the full content of one MolViewSpec concept primer (markdown, possibly with Quarto callout blocks). Call mvs_doc_list first to discover slugs.',
  inputSchema: z.object({
    slug: z.string().describe('Slug from mvs_doc_list, e.g. "primitives" or "selectors".'),
  }),
  async handler({ slug }) {
    return j(await api(`/api/dev/docs/${encodeURIComponent(slug)}`));
  },
});

defineTool({
  name: 'example_list',
  description:
    'List curated mol-view-stories example stories shipped under cli/examples/. Each entry has {name, title, kind, scene_count}. Use example_get to read a specific one, or example_load to seed the current session with one.',
  inputSchema: z.object({}),
  async handler() {
    return j(await api('/api/dev/examples'));
  },
});

defineTool({
  name: 'example_get',
  description:
    "Read all files of one example as raw strings: story.yaml, optional story.js, and each scene's yaml/markdown/javascript. Binary assets are not inlined — only their filenames are listed. Use this to study a working pattern before writing your own.",
  inputSchema: z.object({
    name: z.string().describe('Example name from example_list, e.g. "motm-300" or "learning-simple-inline".'),
  }),
  async handler({ name }) {
    return j(await api(`/api/dev/example/${encodeURIComponent(name)}`));
  },
});

defineTool({
  name: 'example_load',
  description:
    "Replace the current session's story with the parsed contents of an example. Use this as a starting point when the user says 'load X and adapt it' — it overwrites whatever was in the session. Returns the loaded story. Binary assets are NOT copied (scene JS typically references them via http URLs).",
  inputSchema: z.object({
    name: z.string().describe('Example name from example_list.'),
  }),
  async handler({ name }) {
    return j(await api(`/api/dev/example/${encodeURIComponent(name)}/load`, { method: 'POST' }));
  },
});

// ---- Export ----

defineTool({
  name: 'story_export',
  description:
    "Export the story. format='mvsj' returns the JSON string; format='folder' returns a map of relative_path -> file contents (and writes them to disk under out_dir if provided); format='mvsx' returns base64 of a ZIP.",
  inputSchema: z.object({
    format: z.enum(['mvsj', 'mvsx', 'folder']),
    out_dir: z
      .string()
      .optional()
      .describe(
        "Filesystem path. For format='folder', files are written here. For format='mvsj' or 'mvsx', the single file is written here as story.{mvsj|mvsx}. Optional."
      ),
  }),
  async handler({ format, out_dir }) {
    const res = await api<
      | { ok: true; format: 'mvsj'; content: string }
      | { ok: true; format: 'mvsx'; content_base64: string }
      | { ok: true; format: 'folder'; files: Record<string, string> }
      | { ok: false; error: unknown }
    >('/api/dev/export', { method: 'POST', body: JSON.stringify({ format }) });

    if (!res.ok) return j(res);

    if (!out_dir) {
      // Don't return huge content if no out_dir; summarize.
      if (res.format === 'folder') {
        return j({ ok: true, format, file_count: Object.keys(res.files).length, files: Object.keys(res.files) });
      }
      return j({ ok: true, format, length: 'content' in res ? res.content.length : res.content_base64.length });
    }

    await mkdir(out_dir, { recursive: true });
    if (res.format === 'folder') {
      for (const [rel, content] of Object.entries(res.files)) {
        const abs = path.join(out_dir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
      }
      return j({ ok: true, format, out_dir, written: Object.keys(res.files) });
    }
    if (res.format === 'mvsj') {
      const out = path.join(out_dir, 'story.mvsj');
      await writeFile(out, res.content, 'utf8');
      return j({ ok: true, format, path: out });
    }
    // mvsx
    const out = path.join(out_dir, 'story.mvsx');
    await writeFile(out, Buffer.from(res.content_base64, 'base64'));
    return j({ ok: true, format, path: out });
  },
});

// --------------------- Server wiring ---------------------

const server = new Server(
  {
    name: 'mvs-mcp',
    version: '0.1.0',
  },
  {
    capabilities: { tools: {} },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const parsed = tool.inputSchema.parse(args ?? {});
    const result = await tool.handler(parsed);
    return { content: [{ type: 'text', text: result }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

// Minimal Zod-to-JSON-Schema converter (good enough for tool input shapes).
// We avoid a dependency for portability; the shapes we use are simple.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    for (const [k, v] of Object.entries(shape)) {
      props[k] = zodToJsonSchema(v);
      if (!v.isOptional()) required.push(k);
    }
    const out: Record<string, unknown> = { type: 'object', properties: props };
    if (required.length) out.required = required;
    return out;
  }
  if (schema instanceof z.ZodString) return withDesc({ type: 'string' }, schema);
  if (schema instanceof z.ZodNumber) return withDesc({ type: 'number' }, schema);
  if (schema instanceof z.ZodBoolean) return withDesc({ type: 'boolean' }, schema);
  if (schema instanceof z.ZodArray) {
    return withDesc({ type: 'array', items: zodToJsonSchema(schema.element) }, schema);
  }
  if (schema instanceof z.ZodEnum) {
    return withDesc({ type: 'string', enum: schema.options }, schema);
  }
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodEffects) return zodToJsonSchema(schema.innerType());
  return {};
}

function withDesc(base: Record<string, unknown>, schema: z.ZodTypeAny): Record<string, unknown> {
  const d = (schema as { description?: string }).description;
  return d ? { ...base, description: d } : base;
}

// --------------------- Boot ---------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stderr is the only safe place to log on stdio MCP servers.
  process.stderr.write(`mvs-mcp ready (target: ${BASE})\n`);
}

main().catch((err) => {
  process.stderr.write(`mvs-mcp fatal: ${err.message}\n`);
  process.exit(1);
});
