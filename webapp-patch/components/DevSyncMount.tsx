'use client';

/**
 * DevSyncMount
 *
 * Tiny client-only component that polls /api/dev/story every 2 seconds.
 * When updatedAt advances, it dispatches a window event that the editor
 * Zustand store can listen to so it re-hydrates from disk.
 *
 * Wire-up in your editor store:
 *
 *   useEffect(() => {
 *     function refresh(e: CustomEvent) {
 *       const story = e.detail;
 *       useEditorStore.getState().loadFromDevApi(story);
 *     }
 *     window.addEventListener('mvs-dev:story-changed', refresh as EventListener);
 *     return () =>
 *       window.removeEventListener('mvs-dev:story-changed', refresh as EventListener);
 *   }, []);
 *
 * The component is a no-op outside dev mode.
 */

import { useEffect, useRef } from 'react';
import { authenticatedFetch } from '@/lib/auth/token-manager';
import { devApiUrl } from '@/lib/dev-sync';

export function DevSyncMount() {
  const lastSeen = useRef<number>(0);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEV_API !== '1') return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await authenticatedFetch(devApiUrl('/api/dev/story'), { cache: 'no-store' });
        if (!res.ok) return;
        const story = (await res.json()) as { updatedAt?: number };
        const stamp = story.updatedAt ?? 0;
        if (stamp > lastSeen.current) {
          lastSeen.current = stamp;
          window.dispatchEvent(new CustomEvent('mvs-dev:story-changed', { detail: story }));
        }
      } catch {
        // Network blip, ignore.
      }
    }

    tick();
    const id = setInterval(() => {
      if (!cancelled) tick();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
