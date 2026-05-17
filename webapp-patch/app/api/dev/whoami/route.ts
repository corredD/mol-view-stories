/**
 * GET /api/dev/whoami
 *
 * Used by the MCP server's auth_set / auth_status tools to verify a token is
 * valid and report who it identifies. Re-runs requireUser, which under the hood
 * calls OIDC userinfo (cached) and returns the user's `sub`.
 *
 * To keep the response small and stable, we also surface the user's display
 * name / preferred_username when the OIDC IdP returns them. Those fields live
 * in the userinfo payload that the auth cache currently discards — when we
 * need them in more than one place we'll plumb them through; for now this
 * route re-queries userinfo to populate them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireUser } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = await requireUser(req);
  if ('error' in auth) return auth.error;

  // Best-effort display name from the IdP. We re-hit userinfo here rather than
  // teaching the cache about extra fields — this route is only hit on session
  // setup, not on every poll, so the round-trip is fine.
  const bearer = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
  const token = bearer.split(/\s+/, 2)[1];
  let display: { name?: string; preferred_username?: string } = {};
  if (token) {
    const userinfoUrl =
      process.env.OIDC_USERINFO_URL ?? 'https://login.aai.lifescience-ri.eu/oidc/userinfo';
    try {
      const r = await fetch(userinfoUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (r.ok) display = await r.json();
    } catch {
      // Display fields are decoration; ignore failures.
    }
  }

  return NextResponse.json({
    sub: auth.userId,
    name: display.name,
    preferred_username: display.preferred_username,
  });
}
