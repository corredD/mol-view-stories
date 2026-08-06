/**
 * Reference-material helpers for the dev API.
 *
 * Surfaces three sources of truth that the MCP / Claude need to write good
 * scene JS:
 *   1. MVSTypes — the full .d.ts the Monaco editor uses, re-exported from
 *      @mol-view-stories/lib. Authoritative for builder method signatures.
 *   2. docs/molviewspec/*.qmd — curated human-written concept primers.
 *   3. cli/examples/* — real, working story folders (inline or folder layout).
 *
 * All paths are resolved from the repo root, located by walking up from
 * process.cwd() looking for pnpm-workspace.yaml. This keeps the lookup robust
 * regardless of where the Next.js process was launched from.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { MVSTypes } from '@mol-view-stories/lib';
import type { Story, Scene } from '@/lib/dev-store';

let cachedRepoRoot: string | null = null;
export function repoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate repo root (no pnpm-workspace.yaml found walking up)');
}

// ─── MVS types ────────────────────────────────────────────────────────────

/**
 * Returns the MVSTypes declaration string. When `node` is given, attempts to
 * narrow to the `declare class <Cap>` block matching that node (case-insensitive).
 * Always returns *something* — falls back to the full file if no match.
 */
export function getMvsTypes(node?: string): { node: string | null; content: string; truncated: boolean } {
  if (!node) return { node: null, content: MVSTypes, truncated: false };
  const cap = node.charAt(0).toUpperCase() + node.slice(1).toLowerCase();
  // Aliases for the MCP node names that don't 1:1 match class names.
  const aliases: Record<string, string[]> = {
    structure_primitives: ['Primitives'],
  };
  const candidates = aliases[node.toLowerCase()] ?? [cap];

  for (const name of candidates) {
    const re = new RegExp(`(declare class ${name}\\b[\\s\\S]*?\\n    \\})`);
    const m = MVSTypes.match(re);
    if (m) return { node: name, content: m[1], truncated: true };
  }
  return { node: null, content: MVSTypes, truncated: false };
}

// ─── Docs ─────────────────────────────────────────────────────────────────

const DOCS_ROOT_REL = 'docs';

export interface DocInfo {
  slug: string;
  title: string;
  path: string;
}

/** Recursively walk docs/ for .qmd files. Slug = path relative to docs/, no extension. */
export function listDocs(): DocInfo[] {
  const root = repoRoot();
  const docsRoot = path.join(root, DOCS_ROOT_REL);
  if (!fs.existsSync(docsRoot)) return [];
  const out: DocInfo[] = [];
  walk(docsRoot, docsRoot, out);
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

function walk(rootAbs: string, dir: string, out: DocInfo[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip non-content dirs (assets, images, JS samples included by qmd pages).
      if (entry.name === 'assets' || entry.name === 'img' || entry.name === 'js' || entry.name.startsWith('_'))
        continue;
      walk(rootAbs, abs, out);
      continue;
    }
    if (!entry.name.endsWith('.qmd')) continue;
    const rel = path.relative(rootAbs, abs).replace(/\\/g, '/');
    const slug = rel.replace(/\.qmd$/, '');
    out.push(toDocInfo(abs, slug));
  }
}

function toDocInfo(absPath: string, slug: string): DocInfo {
  const head = readHead(absPath, 20);
  const title = extractTitle(head) ?? slug;
  return { slug, title, path: absPath };
}

/** Resolve a slug to its .qmd path safely (no traversal outside docs/). */
function resolveDocPath(slug: string): string | null {
  const root = repoRoot();
  const docsRoot = path.join(root, DOCS_ROOT_REL);
  const target = path.normalize(path.join(docsRoot, `${slug}.qmd`));
  // Containment check — guard against ../ escapes.
  if (target !== docsRoot && !target.startsWith(docsRoot + path.sep)) return null;
  return fs.existsSync(target) ? target : null;
}

function readHead(absPath: string, lines: number): string {
  const buf = fs.readFileSync(absPath, 'utf8');
  return buf.split('\n', lines).join('\n');
}

function extractTitle(text: string): string | null {
  // Quarto frontmatter: --- ... title: "..." ---
  const fm = text.match(/^---\s*([\s\S]*?)\s*---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (t) return t[1];
  }
  // Or the first markdown h1.
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1) return h1[1];
  return null;
}

export function readDoc(slug: string): { slug: string; title: string; content: string } | null {
  const abs = resolveDocPath(slug);
  if (!abs) return null;
  const content = fs.readFileSync(abs, 'utf8');
  const title = extractTitle(content.split('\n', 20).join('\n')) ?? slug;
  return { slug, title, content };
}

// ─── Examples ─────────────────────────────────────────────────────────────

const EXAMPLES_DIR = 'cli/examples';

export interface ExampleSummary {
  name: string;
  title: string;
  kind: 'inline' | 'folder';
  scene_count: number;
}

export function listExamples(): ExampleSummary[] {
  const root = repoRoot();
  const dir = path.join(root, EXAMPLES_DIR);
  if (!fs.existsSync(dir)) return [];
  const out: ExampleSummary[] = [];
  for (const name of fs.readdirSync(dir)) {
    const exDir = path.join(dir, name);
    const storyYaml = path.join(exDir, 'story.yaml');
    if (!fs.statSync(exDir).isDirectory() || !fs.existsSync(storyYaml)) continue;
    try {
      const parsed = parseYaml(fs.readFileSync(storyYaml, 'utf8')) as RawStoryYaml;
      const all = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      const folderScenes = all.filter((s): s is RawSceneFolder => 'folder' in s && !!s.folder);
      const inlineScenes = all.filter((s): s is RawSceneInline => !('folder' in s) || !s.folder);
      const kind: 'inline' | 'folder' = folderScenes.length > 0 ? 'folder' : 'inline';
      const scene_count = inlineScenes.length + folderScenes.length;
      out.push({ name, title: parsed.title ?? name, kind, scene_count });
    } catch {
      // skip examples whose yaml fails to parse — they shouldn't crash the listing.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

interface RawSceneInline {
  id?: string;
  key?: string;
  header?: string;
  description?: string;
  javascript?: string;
  linger_duration_ms?: number;
  transition_duration_ms?: number;
  camera?: unknown;
}
interface RawSceneFolder {
  folder: string;
  key?: string;
  header?: string;
}
interface RawStoryYaml {
  title?: string;
  author_note?: string;
  global_js?: string;
  scenes?: Array<RawSceneInline | RawSceneFolder>;
}

export interface ExampleFiles {
  name: string;
  title: string;
  kind: 'inline' | 'folder';
  story_yaml: string;
  story_js?: string;
  scenes: Array<{ key: string; name?: string; yaml?: string; markdown?: string; javascript?: string }>;
  assets: string[];
}

/** Read all the files of an example as raw strings, useful for reference. */
export function readExample(name: string): ExampleFiles | null {
  const root = repoRoot();
  const exDir = path.join(root, EXAMPLES_DIR, name);
  const storyYamlPath = path.join(exDir, 'story.yaml');
  if (!fs.existsSync(storyYamlPath)) return null;
  const story_yaml = fs.readFileSync(storyYamlPath, 'utf8');
  const parsed = parseYaml(story_yaml) as RawStoryYaml;

  const storyJsPath = path.join(exDir, 'story.js');
  const story_js = fs.existsSync(storyJsPath) ? fs.readFileSync(storyJsPath, 'utf8') : undefined;

  const scenes: ExampleFiles['scenes'] = [];
  const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const isFolder = rawScenes.some((s) => 'folder' in s && s.folder);

  for (const raw of rawScenes) {
    if ('folder' in raw && raw.folder) {
      const sceneDir = path.join(exDir, 'scenes', raw.folder);
      const key = raw.key ?? raw.folder;
      const yamlPath = path.join(sceneDir, `${raw.folder}.yaml`);
      const mdPath = path.join(sceneDir, `${raw.folder}.md`);
      const jsPath = path.join(sceneDir, `${raw.folder}.js`);
      scenes.push({
        key,
        name: raw.header ?? key,
        yaml: fs.existsSync(yamlPath) ? fs.readFileSync(yamlPath, 'utf8') : undefined,
        markdown: fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : undefined,
        javascript: fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : undefined,
      });
    } else {
      const inline = raw as RawSceneInline;
      scenes.push({
        key: inline.key ?? inline.id ?? '',
        name: inline.header,
        markdown: inline.description,
        javascript: inline.javascript,
      });
    }
  }

  const assetsDir = path.join(exDir, 'assets');
  const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

  return {
    name,
    title: parsed.title ?? name,
    kind: isFolder ? 'folder' : 'inline',
    story_yaml,
    story_js,
    scenes,
    assets,
  };
}

/** Parse an example into the dev-store Story shape, ready to write into a session. */
export function exampleToStory(name: string): Story | null {
  const root = repoRoot();
  const exDir = path.join(root, EXAMPLES_DIR, name);
  const storyYamlPath = path.join(exDir, 'story.yaml');
  if (!fs.existsSync(storyYamlPath)) return null;
  const parsed = parseYaml(fs.readFileSync(storyYamlPath, 'utf8')) as RawStoryYaml;

  const storyJsPath = path.join(exDir, 'story.js');
  const fileStoryJs = fs.existsSync(storyJsPath) ? fs.readFileSync(storyJsPath, 'utf8') : '';
  const story_js = (parsed.global_js ?? fileStoryJs ?? '').trim();

  const scenes: Scene[] = [];
  for (const raw of parsed.scenes ?? []) {
    if ('folder' in raw && raw.folder) {
      const sceneDir = path.join(exDir, 'scenes', raw.folder);
      const yamlPath = path.join(sceneDir, `${raw.folder}.yaml`);
      const mdPath = path.join(sceneDir, `${raw.folder}.md`);
      const jsPath = path.join(sceneDir, `${raw.folder}.js`);
      const sceneYaml = fs.existsSync(yamlPath)
        ? (parseYaml(fs.readFileSync(yamlPath, 'utf8')) as RawSceneInline & { camera?: unknown })
        : ({} as RawSceneInline);
      scenes.push({
        key: sceneYaml.key ?? raw.key ?? raw.folder,
        name: sceneYaml.header ?? raw.header ?? raw.folder,
        description: fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '',
        javascript: fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '',
        linger_duration_ms: sceneYaml.linger_duration_ms,
        transition_duration_ms: sceneYaml.transition_duration_ms,
        camera: sceneYaml.camera,
      });
    } else {
      const inline = raw as RawSceneInline;
      scenes.push({
        key: inline.key ?? inline.id ?? '',
        name: inline.header ?? inline.key ?? inline.id ?? '',
        description: inline.description ?? '',
        javascript: inline.javascript ?? '',
        linger_duration_ms: inline.linger_duration_ms,
        transition_duration_ms: inline.transition_duration_ms,
        camera: inline.camera,
      });
    }
  }

  return {
    title: parsed.title ?? name,
    author_note: parsed.author_note ?? '',
    settings: { autoPlay: false, loopStory: false, showControls: true },
    story_js,
    scenes,
    updatedAt: Date.now(),
  };
}
