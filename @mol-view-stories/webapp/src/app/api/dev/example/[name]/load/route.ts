/**
 * POST /api/dev/example/[name]/load -> writes the parsed example into the
 * session's dev-store, overwriting whatever was there. Returns the new story.
 *
 * Equivalent to the editor's "load example" but driven from MCP. Binary
 * assets (PDB/CIF/MP3 under cli/examples/<name>/assets) are NOT copied —
 * scene JS in the examples references them via http URLs already, or the
 * caller can upload assets separately once we add an assets pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled, writeStory } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';
import { exampleToStory } from '@/lib/dev-references';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function POST(req: NextRequest, context: { params: Promise<{ name: string }> }) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const { name } = await context.params;
  const story = exampleToStory(name);
  if (!story) return NextResponse.json({ error: `unknown example: ${name}` }, { status: 404 });
  const written = await writeStory(auth.sessionId, story);
  return NextResponse.json(written);
}
