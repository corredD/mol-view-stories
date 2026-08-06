/**
 * Session-ID auth for /api/dev/* and /api/mcp.
 *
 * The MCP loop has no real "identity" requirement — we just need a routing
 * tag that lets the browser tab and the MCP client share an in-memory slot
 * on the server. So instead of validating OIDC tokens, we mint an opaque
 * random session ID via POST /api/dev/session and let both sides quote it
 * as `Authorization: Bearer <id>` or `?token=<id>` on every request.
 *
 * Sessions live in process memory only — they die on restart, which matches
 * the in-memory dev-store. An idle TTL prevents abandoned IDs from piling
 * up.
 *
 * Save/Publish is a separate flow handled by the Flask backend with OIDC;
 * the MCP loop intentionally doesn't depend on it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h idle

// Pinned to globalThis for the same reason as the dev-store map: `next dev`
// re-instantiates modules as it lazily compiles routes, so a plain const map
// would drop every live session the first time a client hits a route that
// hasn't been compiled yet — the user sees a spurious 401 mid-conversation.
type SessionRecord = { createdAt: number; lastSeenAt: number };
const globalForSessions = globalThis as typeof globalThis & {
  __mvsDevSessions?: Map<string, SessionRecord>;
};
const sessions: Map<string, SessionRecord> = (globalForSessions.__mvsDevSessions ??= new Map());

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastSeenAt: number;
}

export function mintSession(): SessionInfo {
  const id = randomBytes(24).toString('base64url');
  const now = Date.now();
  sessions.set(id, { createdAt: now, lastSeenAt: now });
  return { id, createdAt: now, lastSeenAt: now };
}

export function touchSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  const now = Date.now();
  if (now - s.lastSeenAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return false;
  }
  s.lastSeenAt = now;
  return true;
}

export function revokeSession(id: string): void {
  sessions.delete(id);
}

export type RequireSessionResult = { sessionId: string } | { error: NextResponse };

function bearerFrom(req: NextRequest): string | null {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery;
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth) return null;
  const [scheme, token] = auth.split(/\s+/, 2);
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

/** Validate a session token from `Authorization: Bearer <id>` or `?token=<id>`. */
export function requireSession(req: NextRequest): RequireSessionResult {
  const token = bearerFrom(req);
  if (!token) {
    return { error: NextResponse.json({ error: 'unauthorized', detail: 'missing session token' }, { status: 401 }) };
  }
  if (!touchSession(token)) {
    return {
      error: NextResponse.json(
        { error: 'unauthorized', detail: 'unknown or expired session — mint a new one via POST /api/dev/session' },
        { status: 401 }
      ),
    };
  }
  return { sessionId: token };
}
