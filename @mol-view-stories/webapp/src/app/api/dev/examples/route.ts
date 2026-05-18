/**
 * GET /api/dev/examples -> [{name, title, kind, scene_count}, ...]
 *
 * Lists curated story examples under cli/examples/. Each is either:
 *   - inline: a single story.yaml with all scene fields embedded
 *   - folder: story.yaml + scenes/<key>/{<key>.yaml,.md,.js}
 *
 * Use /api/dev/example/[name] to read all the files, or
 * POST /api/dev/example/[name]/load to drop one into the session's dev-store.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';
import { listExamples } from '@/lib/dev-references';

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
  return NextResponse.json({ examples: listExamples() });
}
