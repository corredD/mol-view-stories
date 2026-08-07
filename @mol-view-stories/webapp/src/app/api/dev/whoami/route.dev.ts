/**
 * GET /api/dev/whoami
 *
 * With session-ID auth there's no "identity" to return — just confirms the
 * bearer is a known live session. The MCP's auth_set tool hits this right
 * after stashing a token to verify it works and surface a friendly message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  return NextResponse.json({
    sub: auth.sessionId,
    name: `session ${auth.sessionId.slice(0, 8)}…`,
  });
}
