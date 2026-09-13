/**
 * GET /api/dev/docs -> [{slug, title}, ...]
 *
 * Lists the curated MolViewSpec concept primers under docs/molviewspec plus
 * docs/molviewspec-primer. Each can be fetched via /api/dev/docs/[slug].
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';
import { hasReferenceMaterial, listDocs } from '@/lib/dev-references';

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
  const docs = listDocs().map(({ slug, title }) => ({ slug, title }));
  // An empty list means one of two very different things; say which, so an agent
  // doesn't conclude the docs simply don't exist on a deploy that omits them.
  return NextResponse.json({
    docs,
    reference_available: hasReferenceMaterial(),
    ...(hasReferenceMaterial()
      ? {}
      : { note: 'This deployment ships no docs/ tree. Set MVS_REFERENCE_ROOT on the server to enable them.' }),
  });
}
