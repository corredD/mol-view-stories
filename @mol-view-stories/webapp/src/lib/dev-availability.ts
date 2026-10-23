'use client';

/**
 * Is the dev API reachable from this browser?
 *
 * The build flag (NEXT_PUBLIC_DEV_API) says the server has the dev API, but a
 * reverse proxy may still block /api/dev/* for visitors outside a trusted
 * network. Probe GET /api/dev/ping once per page load and share the answer, so
 * the MCP menu and dev sync only appear where the API actually answers.
 */

import { useEffect, useState } from 'react';
import { devApiUrl } from '@/lib/dev-sync';

let probe: Promise<boolean> | null = null;

export function checkDevApiAvailable(): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_DEV_API !== '1') return Promise.resolve(false);
  if (!probe) {
    probe = fetch(devApiUrl('/api/dev/ping/'), { cache: 'no-store' })
      .then((res) => res.ok)
      .catch(() => false);
  }
  return probe;
}

/** `null` while the probe is in flight, then whether the dev API answered. */
export function useDevApiAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    checkDevApiAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}
