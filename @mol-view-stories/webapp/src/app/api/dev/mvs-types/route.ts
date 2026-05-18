/**
 * GET /api/dev/mvs-types          -> full MVSTypes .d.ts string
 * GET /api/dev/mvs-types?node=structure  -> just the `declare class Structure` slice
 *
 * Source of truth for builder method signatures. Same content Monaco uses for
 * IntelliSense, so anything Claude writes against it should match what the
 * editor sees.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';
import { getMvsTypes } from '@/lib/dev-references';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  void auth.sessionId;
  const url = new URL(req.url);
  const node = url.searchParams.get('node') ?? undefined;
  const { node: matched, content, truncated } = getMvsTypes(node);
  return NextResponse.json({
    requested_node: node ?? null,
    matched_node: matched,
    truncated,
    content,
  });
}
