'use client';

/**
 * DevSyncListener
 *
 * The other half of DevSyncMount. DevSyncMount polls /api/dev/story and fires
 * a window event when the file on disk changes. This component:
 *
 *   1. Listens for that event and writes the result into StoryAtom so the
 *      browser editor reflects whatever the MCP server has done.
 *   2. Subscribes to StoryAtom and pushes user edits back to /api/dev/story
 *      via PUT, so the MCP server reads consistent state next time it polls.
 *
 * Loop prevention: every time we sync either direction, we record a fingerprint
 * of the dev-shaped story. A reverse-sync push is skipped when the new editor
 * state projects to the same fingerprint we last applied or pushed.
 */

import { useEffect, useRef } from 'react';
import { getDefaultStore } from 'jotai';
import { devFetch } from '@/lib/dev-session';
import { StoryAtom } from '@/app/state/atoms';
import {
  applyDevStoryToEditor,
  devApiUrl,
  devStoryFingerprint,
  editorStoryToDev,
  type DevStory,
} from '@/lib/dev-sync';

export function DevSyncListener() {
  const lastFingerprint = useRef<string | null>(null);
  const lastDevSnapshot = useRef<DevStory | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEV_API !== '1') return;
    const store = getDefaultStore();

    // ---- dev → editor ----
    function onDevChanged(e: Event) {
      const dev = (e as CustomEvent<DevStory>).detail;
      if (!dev || !Array.isArray(dev.scenes)) return;
      const fp = devStoryFingerprint(dev);
      if (fp === lastFingerprint.current) return; // already applied
      lastFingerprint.current = fp;
      lastDevSnapshot.current = dev;
      const current = store.get(StoryAtom);
      store.set(StoryAtom, applyDevStoryToEditor(dev, current));
    }
    window.addEventListener('mvs-dev:story-changed', onDevChanged as EventListener);

    // ---- editor → dev ----
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    async function pushNow() {
      pushTimer = null;
      if (inFlight) {
        // Coalesce: re-arm so the latest state goes after the in-flight one resolves.
        pushTimer = setTimeout(pushNow, 200);
        return;
      }
      const editor = store.get(StoryAtom);
      const projected = editorStoryToDev(editor, lastDevSnapshot.current);
      const fp = devStoryFingerprint(projected);
      if (fp === lastFingerprint.current) return;
      lastFingerprint.current = fp;
      try {
        inFlight = true;
        const res = await devFetch(devApiUrl('/api/dev/story'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projected),
          cache: 'no-store',
        });
        if (res.ok) {
          lastDevSnapshot.current = (await res.json()) as DevStory;
        }
      } catch {
        // Network blip — next StoryAtom change will retry.
      } finally {
        inFlight = false;
      }
    }

    const unsub = store.sub(StoryAtom, () => {
      // Debounce: editor mutations during typing can be very rapid.
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 250);
    });

    // Prime the fingerprint so the first StoryAtom subscription tick (with the
    // initial EmptyStory) doesn't clobber whatever is already in the dev store.
    (async () => {
      try {
        const res = await devFetch(devApiUrl('/api/dev/story'), { cache: 'no-store' });
        if (!res.ok) return;
        const dev = (await res.json()) as DevStory;
        lastDevSnapshot.current = dev;
        lastFingerprint.current = devStoryFingerprint(dev);
        const current = store.get(StoryAtom);
        store.set(StoryAtom, applyDevStoryToEditor(dev, current));
      } catch {
        // Dev server not up yet — DevSyncMount will retry via polling.
      }
    })();

    return () => {
      window.removeEventListener('mvs-dev:story-changed', onDevChanged as EventListener);
      unsub();
      if (pushTimer) clearTimeout(pushTimer);
    };
  }, []);

  return null;
}
