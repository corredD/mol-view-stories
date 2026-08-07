/**
 * POST /api/dev/session   -> mint a new session ID (no auth)
 * GET  /api/dev/session   -> echo whether the bearer is still valid
 * DELETE /api/dev/session -> revoke the bearer
 *
 * Browsers call POST once on first visit and store the ID. The MCP client
 * also uses this ID — the user reads it from the Start MCP dialog and
 * pastes it into Claude.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { mintSession, requireSession, revokeSession } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function POST() {
  if (!isDevEnabled()) return notFound();
  return NextResponse.json(mintSession());
}

export async function GET(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ sessionId: auth.sessionId, ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  revokeSession(auth.sessionId);
  return NextResponse.json({ ok: true });
}
