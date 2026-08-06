/**
 * Per-user in-memory store for live MCP-driven editing.
 *
 * This is intentionally NOT a persistence layer. Saved/published stories live
 * in MinIO behind the Flask api/ backend (see api/storage). What this module
 * holds is the in-progress story currently being shaped between an MCP client
 * and a user's open browser editor tab — a live scratchpad keyed by the user's
 * OIDC `sub`. It dies on server restart, which is fine: the user persists
 * through the normal Save flow when they want the work kept.
 *
 * All routes go through requireUser() (lib/dev-auth.ts), which validates the
 * incoming bearer token against the OIDC IdP and yields the userId that keys
 * every function in this file.
 */

export interface Scene {
  key: string;
  name: string;
  description: string;
  javascript: string;
  linger_duration_ms?: number;
  transition_duration_ms?: number;
  camera?: unknown;
}

export interface Story {
  title: string;
  author_note?: string;
  settings?: {
    autoPlay?: boolean;
    loopStory?: boolean;
    showControls?: boolean;
  };
  story_js: string;
  scenes: Scene[];
  updatedAt: number;
}

// Pinned to globalThis, not a plain module-level const: `next dev` compiles
// route handlers lazily and re-instantiates the module graph as new routes
// come online, which would silently reset the store the first time an MCP
// client touches a route nobody has hit yet. The global survives that.
const globalForStore = globalThis as typeof globalThis & {
  __mvsDevStories?: Map<string, Story>;
};
const stories: Map<string, Story> = (globalForStore.__mvsDevStories ??= new Map());

function emptyStory(): Story {
  return {
    title: 'Untitled story',
    author_note: '',
    settings: { autoPlay: false, loopStory: false, showControls: true },
    story_js: '',
    scenes: [],
    updatedAt: Date.now(),
  };
}

export function isDevEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_API === '1';
}

export async function readStory(userId: string): Promise<Story> {
  return stories.get(userId) ?? emptyStory();
}

export async function writeStory(userId: string, s: Story): Promise<Story> {
  const next = { ...s, updatedAt: Date.now() };
  stories.set(userId, next);
  return next;
}

export async function patchStory(userId: string, p: Partial<Story>): Promise<Story> {
  const cur = await readStory(userId);
  return writeStory(userId, { ...cur, ...p });
}

export async function upsertScene(userId: string, scene: Scene): Promise<Story> {
  const s = await readStory(userId);
  const i = s.scenes.findIndex((x) => x.key === scene.key);
  const scenes = [...s.scenes];
  if (i >= 0) scenes[i] = { ...scenes[i], ...scene };
  else scenes.push(scene);
  return writeStory(userId, { ...s, scenes });
}

export async function deleteScene(userId: string, key: string): Promise<Story> {
  const s = await readStory(userId);
  return writeStory(userId, { ...s, scenes: s.scenes.filter((x) => x.key !== key) });
}

export async function reorderScenes(userId: string, orderedKeys: string[]): Promise<Story> {
  const s = await readStory(userId);
  const map = new Map(s.scenes.map((sc) => [sc.key, sc]));
  const scenes = orderedKeys.map((k) => map.get(k)).filter((x): x is Scene => x !== undefined);
  return writeStory(userId, { ...s, scenes });
}
