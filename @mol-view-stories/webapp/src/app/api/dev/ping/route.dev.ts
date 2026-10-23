/**
 * GET /api/dev/ping
 *
 * Unauthenticated, stateless reachability probe for the editor UI. Returns
 * 204 when the dev API is enabled. The reverse proxy can restrict /api/dev/*
 * to a trusted network; a browser outside it gets a 403 here, and the editor
 * then hides the MCP menu and skips dev sync (see lib/dev-availability.ts).
 */

import { NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isDevEnabled()) return new NextResponse('Not Found', { status: 404 });
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
