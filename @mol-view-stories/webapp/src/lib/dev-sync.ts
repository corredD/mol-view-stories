/**
 * Adapters between the dev-store Story shape (lib/dev-store.ts, also the
 * shape persisted to .mvs-dev/story.json and exchanged over /api/dev/*) and
 * the editor's in-memory Story shape (@mol-view-stories/lib).
 *
 * The dev-store is flatter: { title, author_note, story_js, scenes:[{key,name,...}] }.
 * The editor uses: { metadata:{title,author_note}, javascript, scenes:[{id,key,header,...}], assets }.
 *
 * UUIDs (SceneData.id) only exist on the editor side; we preserve them across
 * an apply by matching scenes by key. Assets only exist on the editor side; we
 * preserve them as-is. Dev-store `settings` and `updatedAt` only exist on the
 * dev side and are preserved by the reverse direction.
 */

import { UUID } from 'molstar/lib/mol-util/uuid';
import type { Story as EditorStory, SceneData } from '@mol-view-stories/lib';
import type { Story as DevStory, Scene as DevScene } from '@/lib/dev-store';

export type { DevStory, DevScene };

/**
 * Build a URL for a /api/dev/* route honoring NEXT_PUBLIC_BASE_PATH so the
 * same fetch works in dev (basePath="") and under a deployed prefix like
 * "/mol-view-stories". `path` should start with "/".
 */
export function devApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${base}${path}`;
}

/**
 * Merge a dev-store story onto the current editor story, preserving UUIDs and assets.
 *
 * Editor-only fields the dev shape doesn't model — `assets`, and the UI builder
 * state added by the state-builder integration — are carried over from `current`
 * rather than dropped, otherwise every MCP edit would wipe them. Scene-level UI
 * state is matched by `key`, same as the UUIDs.
 */
export function applyDevStoryToEditor(dev: DevStory, current: EditorStory): EditorStory {
  const idByKey = new Map<string, string>();
  const uiStateByKey = new Map<string, SceneData['ui_builder_state']>();
  for (const s of current.scenes) {
    if (s.key) {
      idByKey.set(s.key, s.id);
      if (s.ui_builder_state) uiStateByKey.set(s.key, s.ui_builder_state);
    }
  }
  const scenes: SceneData[] = dev.scenes.map((s) => ({
    id: idByKey.get(s.key) ?? UUID.createv4(),
    key: s.key,
    header: s.name,
    description: s.description ?? '',
    javascript: s.javascript ?? '',
    linger_duration_ms: s.linger_duration_ms,
    transition_duration_ms: s.transition_duration_ms,
    camera: (s.camera as SceneData['camera']) ?? null,
    ui_builder_state: uiStateByKey.get(s.key),
  }));
  return {
    metadata: {
      title: dev.title,
      author_note: dev.author_note,
    },
    javascript: dev.story_js ?? '',
    scenes,
    assets: current.assets ?? [],
    ui_builder_constants: current.ui_builder_constants,
  };
}

/** Project the editor story into the dev-store shape, preserving dev-only fields from `prev`. */
export function editorStoryToDev(editor: EditorStory, prev: DevStory | null): DevStory {
  const scenes: DevScene[] = editor.scenes
    // Only push scenes the dev side can address — keys are the dev-store identity.
    .filter((s) => !!s.key)
    .map((s) => ({
      key: s.key,
      name: s.header,
      description: s.description ?? '',
      javascript: s.javascript ?? '',
      linger_duration_ms: s.linger_duration_ms,
      transition_duration_ms: s.transition_duration_ms,
      camera: s.camera ?? undefined,
    }));
  return {
    title: editor.metadata.title,
    author_note: editor.metadata.author_note ?? '',
    settings: prev?.settings ?? { autoPlay: false, loopStory: false, showControls: true },
    story_js: editor.javascript ?? '',
    scenes,
    // The server bumps updatedAt on every write; this field is overwritten there.
    updatedAt: prev?.updatedAt ?? 0,
  };
}

/** Compare two dev stories for content equality (ignores `updatedAt`). */
export function devStoryContentEqual(a: DevStory, b: DevStory): boolean {
  return devStoryFingerprint(a) === devStoryFingerprint(b);
}

/** Stable JSON projection used for equality / loop-prevention. Excludes updatedAt. */
export function devStoryFingerprint(s: DevStory): string {
  const norm = {
    title: s.title,
    author_note: s.author_note ?? '',
    settings: s.settings ?? {},
    story_js: s.story_js ?? '',
    scenes: s.scenes.map((sc) => ({
      key: sc.key,
      name: sc.name,
      description: sc.description ?? '',
      javascript: sc.javascript ?? '',
      linger_duration_ms: sc.linger_duration_ms ?? null,
      transition_duration_ms: sc.transition_duration_ms ?? null,
      camera: sc.camera ?? null,
    })),
  };
  return JSON.stringify(norm);
}
