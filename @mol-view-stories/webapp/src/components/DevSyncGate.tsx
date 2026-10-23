'use client';

/**
 * Mounts the dev-sync components only when the dev API is reachable, so a
 * visitor outside the trusted network doesn't poll a blocked endpoint.
 */

import { useDevApiAvailable } from '@/lib/dev-availability';
import { DevSyncMount } from '@/components/DevSyncMount';
import { DevSyncListener } from '@/components/DevSyncListener';

export function DevSyncGate() {
  const available = useDevApiAvailable();
  if (!available) return null;
  return (
    <>
      <DevSyncMount />
      <DevSyncListener />
    </>
  );
}
