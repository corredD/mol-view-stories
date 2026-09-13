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
 *
 * ## Adopting an agent's session
 *
 * The pairing used to run browser -> agent: the user copied a token out of the
 * Start MCP dialog and pasted it into the chat. It now runs the other way. An
 * MCP client gets its own session at connect time (see app/api/mcp), calls
 * `editor_open`, and hands the user a link ending in `#mcp-session=<id>`.
 * Opening that link lands here, and we adopt the id instead of minting one — so
 * the tab and the agent share a dev-store slot with nothing to copy or paste.
 *
 * The id travels in the fragment, not the query string, so it stays out of
 * server logs and the Referer header. We strip it from the address bar straight
 * after reading it.
 */

import { devApiUrl } from '@/lib/dev-sync';

const STORAGE_KEY = 'mvs-dev-session-id';
const PAIR_HASH_KEY = 'mcp-session';

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

/**
 * Read `#mcp-session=<id>` from the URL, then scrub it from the address bar so a
 * reload or a shared screenshot doesn't carry the token around.
 */
function takeSessionFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const id = params.get(PAIR_HASH_KEY);
  if (!id) return null;

  params.delete(PAIR_HASH_KEY);
  const rest = params.toString();
  try {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`
    );
  } catch {
    // Non-fatal: worst case the id stays visible in the address bar.
  }
  return id;
}

export async function ensureSession(): Promise<string> {
  // A paired id always wins over whatever this tab used last — the user just
  // clicked a link asking to join that specific agent's session.
  const paired = takeSessionFromUrl();
  if (paired) {
    writeCached(paired);
    return paired;
  }

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
