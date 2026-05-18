/**
 * GET /api/dev/example/[name] -> raw file contents of the example
 *
 * Returns story_yaml, optional story_js, each scene's {yaml, markdown, javascript}
 * as strings, and the list of asset filenames (binary assets not inlined).
 * Use POST .../load to write the parsed result into the session's dev-store.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';
import { readExample } from '@/lib/dev-references';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ name: string }> }) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  void auth.sessionId;
  const { name } = await context.params;
  const example = readExample(name);
  if (!example) return NextResponse.json({ error: `unknown example: ${name}` }, { status: 404 });
  return NextResponse.json(example);
}
