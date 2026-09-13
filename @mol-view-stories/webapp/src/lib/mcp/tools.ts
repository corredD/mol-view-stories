/**
 * The MCP tool registry.
 *
 * This lives in the webapp, next to the `/api/dev/*` routes it wraps, because
 * those routes are fork-local and the two have to version together. Both MCP
 * transports read this one table:
 *
 *   remote  — app/api/mcp/route.dev.ts (Streamable HTTP, the supported install)
 *   stdio   — @mol-view-stories/mcp-server, now a thin bridge onto that route
 *
 * Every handler is a call to a `/api/dev/*` route rather than a direct import of
 * the underlying lib. That is deliberate: the MVS builder sandbox, the builder
 * introspection and the mvsx assembly all live in route files, so calling them
 * over HTTP keeps exactly one implementation of each. When a tool misbehaves the
 * fix is nearly always in the route, not here.
 *
 * Schemas are plain JSON Schema. MCP wants JSON Schema on the wire, so writing
 * it directly removes the zod -> JSON Schema conversion step the stdio server
 * used to carry.
 */

import { MVS_SKILL } from '@/lib/mcp/skill.generated';

export interface McpToolContext {
  /** Dev-store key. Both this connection and the user's tab must agree on it. */
  sessionId: string;
  /** Browser-reachable origin + basePath, used only for links shown to the user. */
  publicBaseUrl: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<string>;
}

// ─── Self-fetch ───────────────────────────────────────────────────────────

/**
 * Base URL for calling our own dev API.
 *
 * Hardcoded to loopback rather than derived from the incoming request: behind a
 * reverse proxy `req.nextUrl.origin` reflects forwarded headers and can point
 * back out through the proxy. The trailing slash is not optional — the app sets
 * `trailingSlash: true`, so an unslashed path 308s and costs an extra hop.
 */
function devApiUrl(pathname: string, query?: Record<string, string | undefined>): string {
  const port = process.env.PORT ?? '3000';
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const slashed = pathname.endsWith('/') ? pathname : `${pathname}/`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, v);
  const suffix = qs.toString() ? `?${qs}` : '';
  return `http://127.0.0.1:${port}${basePath}${slashed}${suffix}`;
}

async function devApi<T>(
  ctx: McpToolContext,
  pathname: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {}
): Promise<T> {
  const { query, ...rest } = init;
  const url = devApiUrl(pathname, query);
  const res = await fetch(url, {
    ...rest,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.sessionId}`,
      ...((rest.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${rest.method ?? 'GET'} ${pathname} -> ${res.status}: ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

const j = (o: unknown) => JSON.stringify(o, null, 2);

// Schema shorthands — these files get noisy fast without them.
const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const int = (description?: string) => ({
  type: 'integer',
  minimum: 0,
  ...(description ? { description } : {}),
});
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const NO_ARGS = { type: 'object', properties: {} };

const NODE_KINDS = [
  'root',
  'structure',
  'component',
  'representation',
  'volume',
  'primitives',
  'structure_primitives',
  'animation',
];

// ─── Registry ─────────────────────────────────────────────────────────────

export const MCP_TOOLS: McpTool[] = [
  // ---- Pairing ----
  {
    name: 'editor_open',
    description:
      "Return the URL the user should open to watch you work. Their browser editor adopts this connection's session, so everything you create appears there live. Call this at the start of a session, before creating scenes, and hand the user the URL. If the user reports they cannot see your changes, send them this link again.",
    inputSchema: NO_ARGS,
    async handler(_args, ctx) {
      return j({
        ok: true,
        url: `${ctx.publicBaseUrl}/builder/#mcp-session=${encodeURIComponent(ctx.sessionId)}`,
        session_id: ctx.sessionId,
        tell_the_user:
          'Open this link to watch the story being built. It pairs your editor tab with this conversation.',
      });
    },
  },
  {
    name: 'auth_status',
    description:
      'Report which editing session this connection is bound to. Useful when a tool call fails unexpectedly or the user is unsure whether their tab is paired.',
    inputSchema: NO_ARGS,
    async handler(_args, ctx) {
      try {
        const who = await devApi<{ sub: string }>(ctx, '/api/dev/whoami');
        return j({ ok: true, session_id: who.sub, paired_url: `${ctx.publicBaseUrl}/builder/` });
      } catch (err) {
        return j({ ok: false, error: (err as Error).message });
      }
    },
  },

  // ---- Story-level ----
  {
    name: 'story_get',
    description:
      'Return the current story: title, author_note, settings, story-wide JS, and the scene list. Always start a session with this so you know what already exists before changing anything.',
    inputSchema: NO_ARGS,
    async handler(_args, ctx) {
      const story = await devApi<Record<string, unknown>>(ctx, '/api/dev/story');
      // Orientation is also sent via the initialize `instructions` field, but not
      // every MCP client surfaces that. Tool results are always shown, so the
      // first call a well-behaved agent makes carries the workflow too.
      return j({
        ...story,
        _guide:
          'Call mvs_skill_get before writing scene JS. Loop: scene_set -> scene_validate({key}) until ok:true. Call editor_open and give the user the URL so they can watch.',
      });
    },
  },
  {
    name: 'story_set_metadata',
    description:
      'Patch story-level metadata: title, author_note, settings (autoPlay, loopStory, showControls), and the story-wide JS block whose helpers are shared by every scene.',
    inputSchema: obj({
      title: str(),
      author_note: str(),
      story_js: str(
        'Story-wide JavaScript shared by all scenes. Define helper functions, constants, colour palettes, transformation matrices. In scope: builder, Vec3, Mat4, Mat3, Quat, MS, decodeColor.'
      ),
      settings: obj({
        autoPlay: { type: 'boolean' },
        loopStory: { type: 'boolean' },
        showControls: { type: 'boolean' },
      }),
    }),
    async handler(args, ctx) {
      return j(await devApi(ctx, '/api/dev/story', { method: 'PATCH', body: JSON.stringify(args) }));
    },
  },

  // ---- Scene-level ----
  {
    name: 'scenes_list',
    description: 'List scene keys, names, and timing in order.',
    inputSchema: NO_ARGS,
    async handler(_args, ctx) {
      return j(await devApi(ctx, '/api/dev/scenes'));
    },
  },
  {
    name: 'scene_get',
    description: 'Return a single scene by key: name, markdown description, JS body, and timing.',
    inputSchema: obj({ key: str('Scene key as set when the scene was created.') }, ['key']),
    async handler(args, ctx) {
      return j(await devApi(ctx, `/api/dev/scene/${encodeURIComponent(String(args.key))}`));
    },
  },
  {
    name: 'scene_create',
    description: 'Create a new scene and return it. Fails if the key already exists — use scene_set to update instead.',
    inputSchema: obj(
      {
        key: str(
          'Stable identifier for the scene. Used by snapshot_key for clickable navigation between scenes, and by markdown [text](#key) links.'
        ),
        name: str('Human-readable scene title.'),
        description: str('Markdown narration for the scene panel.'),
        javascript: str('Scene JS body that builds the MVS tree.'),
        linger_duration_ms: int(),
        transition_duration_ms: int(),
      },
      ['key', 'name']
    ),
    async handler(args, ctx) {
      return j(await devApi(ctx, '/api/dev/scenes', { method: 'POST', body: JSON.stringify(args) }));
    },
  },
  {
    name: 'scene_set',
    description:
      'Update a scene. Any field not provided is left unchanged, so this is the way to edit markdown, JS, or timing without recreating the scene.',
    inputSchema: obj(
      {
        key: str(),
        name: str(),
        description: str(),
        javascript: str(),
        linger_duration_ms: int(),
        transition_duration_ms: int(),
      },
      ['key']
    ),
    async handler(args, ctx) {
      const { key, ...rest } = args;
      return j(
        await devApi(ctx, `/api/dev/scene/${encodeURIComponent(String(key))}`, {
          method: 'PUT',
          body: JSON.stringify(rest),
        })
      );
    },
  },
  {
    name: 'scene_delete',
    description: 'Delete a scene by key.',
    inputSchema: obj({ key: str() }, ['key']),
    async handler(args, ctx) {
      return j(await devApi(ctx, `/api/dev/scene/${encodeURIComponent(String(args.key))}`, { method: 'DELETE' }));
    },
  },
  {
    name: 'scenes_reorder',
    description:
      'Reorder scenes by passing the full list of keys in the new order. Keys you omit are removed from the story; unknown keys are ignored.',
    inputSchema: obj({ order: { type: 'array', items: { type: 'string' } } }, ['order']),
    async handler(args, ctx) {
      return j(await devApi(ctx, '/api/dev/scenes', { method: 'PATCH', body: JSON.stringify(args) }));
    },
  },

  // ---- Validation ----
  {
    name: 'scene_validate',
    description:
      "Run a scene's JS through the real MVS builder and return either the resulting MVSJ snapshot or a structured error with line numbers. Always validate before telling the user a scene is done. Pass scene_js to preview without saving, or key alone to validate the saved scene.",
    inputSchema: obj({
      key: str('Validate the saved scene with this key.'),
      scene_js: str('Validate this JS instead, without saving it.'),
      story_js: str('Override the story-wide JS for this validation run.'),
    }),
    async handler(args, ctx) {
      let js = args.scene_js as string | undefined;
      let sjs = args.story_js as string | undefined;
      const key = args.key as string | undefined;
      if (!js && !key) throw new Error('Provide either key or scene_js');
      if (!js && key) {
        const sc = await devApi<{ javascript: string }>(ctx, `/api/dev/scene/${encodeURIComponent(key)}`);
        js = sc.javascript;
      }
      if (sjs === undefined) {
        const story = await devApi<{ story_js: string }>(ctx, '/api/dev/story');
        sjs = story.story_js;
      }
      return j(
        await devApi(ctx, '/api/dev/validate', {
          method: 'POST',
          body: JSON.stringify({ story_js: sjs, scene_js: js }),
        })
      );
    },
  },

  // ---- Reference ----
  {
    name: 'mvs_skill_get',
    description:
      'Return the full MVS scripting reference: builder chains, the string unions that actually work, palettes, primitives, animations, markdown scene commands, worked patterns, and the validation contract. Read this before writing any non-trivial scene JS — it answers most questions without further tool calls.',
    inputSchema: NO_ARGS,
    async handler() {
      return MVS_SKILL;
    },
  },
  {
    name: 'builder_list_methods',
    description:
      'Introspect the real MVS builder at runtime and return the methods that exist on each node type. Use this BEFORE writing builder code so you never guess a method name. Pass node to narrow; pass node and method for a signature.',
    inputSchema: obj({
      node: { type: 'string', enum: NODE_KINDS },
      method: str(),
    }),
    async handler(args, ctx) {
      return j(
        await devApi(ctx, '/api/dev/builder', {
          query: { node: args.node as string | undefined, method: args.method as string | undefined },
        })
      );
    },
  },
  {
    name: 'mvs_types_get',
    description:
      'Return the MVSTypes TypeScript declarations — the same .d.ts Monaco uses for IntelliSense, and the authority on parameter shapes. Pass node to get just one class block; without it you get the whole ~140 KB file. Pair with builder_list_methods: that one finds names, this one gives exact signatures.',
    inputSchema: obj({
      node: {
        type: 'string',
        enum: ['root', 'structure', 'component', 'representation', 'volume', 'primitives', 'animation'],
        description: 'If given, return only the `declare class <Name>` block for that node.',
      },
    }),
    async handler(args, ctx) {
      return j(await devApi(ctx, '/api/dev/mvs-types', { query: { node: args.node as string | undefined } }));
    },
  },
  {
    name: 'mvs_doc_list',
    description:
      'List the curated MolViewSpec concept primers available via mvs_doc_get — selectors, primitives, volumes, animations, annotations, camera, and the spec overview. Use these when you need to understand a concept rather than look up a signature.',
    inputSchema: NO_ARGS,
    async handler(_args, ctx) {
      return j(await devApi(ctx, '/api/dev/docs'));
    },
  },
  {
    name: 'mvs_doc_get',
    description: 'Return one MolViewSpec concept primer in full. Call mvs_doc_list first to discover slugs.',
    inputSchema: obj({ slug: str('Slug from mvs_doc_list, e.g. "primitives" or "selectors".') }, ['slug']),
    async handler(args, ctx) {
      return j(await devApi(ctx, `/api/dev/docs/${encodeURIComponent(String(args.slug))}`));
    },
  },
  {
    name: 'example_list',
    description:
      'List the curated example stories. Each entry has {name, title, kind, scene_count}. Use example_get to study one, or example_load to seed the session with it.',
    inputSchema: NO_ARGS,
    async handler(_args, ctx) {
      return j(await devApi(ctx, '/api/dev/examples'));
    },
  },
  {
    name: 'example_get',
    description:
      "Read every file of one example as raw strings: story.yaml, optional story.js, and each scene's yaml/markdown/javascript. Binary assets are listed by name only. Use this to study a working pattern before writing your own.",
    inputSchema: obj({ name: str('Example name from example_list, e.g. "motm-300".') }, ['name']),
    async handler(args, ctx) {
      return j(await devApi(ctx, `/api/dev/example/${encodeURIComponent(String(args.name))}`));
    },
  },
  {
    name: 'example_load',
    description:
      "Replace the session's story with an example. Use this when the user says 'load X and adapt it'. It OVERWRITES whatever is in the session. Binary assets are not copied — scene JS refers to them by URL.",
    inputSchema: obj({ name: str('Example name from example_list.') }, ['name']),
    async handler(args, ctx) {
      return j(await devApi(ctx, `/api/dev/example/${encodeURIComponent(String(args.name))}/load`, { method: 'POST' }));
    },
  },

  // ---- Export ----
  {
    name: 'story_export',
    description:
      "Export the story. Returns a download URL the user can click, plus the content inline for the text formats. format='mvsj' is the JSON story file, 'mvsx' is a zip with assets, 'folder' is the source layout as a path -> contents map.",
    inputSchema: obj({ format: { type: 'string', enum: ['mvsj', 'mvsx', 'folder'], description: 'Export format.' } }, [
      'format',
    ]),
    async handler(args, ctx) {
      const format = String(args.format);
      const res = await devApi<
        | { ok: true; format: 'mvsj'; content: string }
        | { ok: true; format: 'mvsx'; content_base64: string }
        | { ok: true; format: 'folder'; files: Record<string, string> }
        | { ok: false; error: unknown }
      >(ctx, '/api/dev/export', { method: 'POST', body: JSON.stringify({ format }) });

      if (!res.ok) return j(res);

      // This server has no filesystem the user can reach, so instead of writing
      // files (what the old stdio-only `out_dir` did) we hand back a link.
      const downloadUrl =
        res.format === 'folder'
          ? undefined
          : `${ctx.publicBaseUrl}/api/dev/export/?format=${res.format}&token=${encodeURIComponent(ctx.sessionId)}`;

      if (res.format === 'folder') {
        return j({ ok: true, format, files: res.files });
      }
      if (res.format === 'mvsj') {
        return j({ ok: true, format, download_url: downloadUrl, content: res.content });
      }
      return j({
        ok: true,
        format,
        download_url: downloadUrl,
        note: 'mvsx is a binary zip; give the user the download_url rather than the bytes.',
        size_base64: res.content_base64.length,
      });
    },
  },
];

export const MCP_TOOL_BY_NAME = new Map(MCP_TOOLS.map((t) => [t.name, t]));
