/**
 * Client-side session-ID helper for the dev API.
 *
 * Mints a session ID on first call (via POST /api/dev/session), caches it in
 * localStorage so it survives reloads, and gives back a `devFetch` that
 * attaches it as `Authorization: Bearer <id>` on every request.
 *
 * Lifetime is the server's idle TTL (currently 24h). If the server forgets a
 * session (restart, TTL expired), the next request fails with 401; clear the
 * cached ID and mint a new one.
 */

import { devApiUrl } from '@/lib/dev-sync';

const STORAGE_KEY = 'mvs-dev-session-id';

let cached: string | null = null;
let inflight: Promise<string> | null = null;

function readCached(): string | null {
  if (cached) return cached;
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCached(id: string): void {
  cached = id;
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode or full — fall back to in-memory only.
  }
}

export function clearSession(): void {
  cached = null;
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function ensureSession(): Promise<string> {
  const existing = readCached();
  if (existing) {
    cached = existing;
    return existing;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch(devApiUrl('/api/dev/session'), {
      method: 'POST',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`failed to mint session: ${res.status}`);
    const data = (await res.json()) as { id: string };
    writeCached(data.id);
    return data.id;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Drop-in `fetch` wrapper that mints/uses the dev session ID and retries
 * once if the server returned 401 (most commonly because the session expired
 * or the server restarted).
 */
export async function devFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  let id = await ensureSession();
  headers.set('Authorization', `Bearer ${id}`);
  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    id = await ensureSession();
    const retryHeaders = new Headers(init.headers ?? {});
    retryHeaders.set('Authorization', `Bearer ${id}`);
    res = await fetch(url, { ...init, headers: retryHeaders });
  }
  return res;
}
