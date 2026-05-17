/**
 * Bearer-token validation for /api/dev/* routes.
 *
 * The MCP server and the browser both send `Authorization: Bearer <token>`
 * where <token> is the Life Science AAI OIDC access token. We validate it by
 * calling the OIDC userinfo endpoint (same approach api/auth.py uses) and
 * extract the stable `sub` claim as the user id that keys the dev store.
 *
 * Validated tokens are cached in-process for 60s so the 2s DevSyncMount poll
 * doesn't hammer the IdP. Cache is keyed by token so a logout/refresh
 * invalidates naturally (a different token shows up on the wire).
 *
 * Local-dev escape hatch: if MVS_DEV_ALLOW_ANON=1 is set AND no Authorization
 * header is present, requests resolve to a fixed "local" user. This is the
 * only way to use /api/dev/* without an IdP — it must be explicitly opted into
 * so a misconfigured prod deploy can't accidentally expose a shared map slot.
 */

import { NextRequest, NextResponse } from 'next/server';

const USERINFO_URL =
  process.env.OIDC_USERINFO_URL ?? 'https://login.aai.lifescience-ri.eu/oidc/userinfo';

const CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

const ANON_USER_ID = 'anon:local';

export type RequireUserResult = { userId: string } | { error: NextResponse };

export async function requireUser(req: NextRequest): Promise<RequireUserResult> {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth) {
    if (process.env.MVS_DEV_ALLOW_ANON === '1') {
      return { userId: ANON_USER_ID };
    }
    return { error: unauthorized('missing Authorization header') };
  }

  const [scheme, token] = auth.split(/\s+/, 2);
  if (!token || scheme.toLowerCase() !== 'bearer') {
    return { error: unauthorized('expected Bearer token') };
  }

  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) {
    return { userId: cached.userId };
  }

  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return { error: unauthorized(`userinfo ${res.status}`) };
    }
    const info = (await res.json()) as { sub?: string };
    if (!info.sub) {
      return { error: unauthorized('userinfo missing sub') };
    }
    tokenCache.set(token, { userId: info.sub, expiresAt: now + CACHE_TTL_MS });
    return { userId: info.sub };
  } catch (err) {
    return { error: unauthorized(`userinfo failed: ${(err as Error).message}`) };
  }
}

function unauthorized(detail: string): NextResponse {
  return NextResponse.json({ error: 'unauthorized', detail }, { status: 401 });
}
