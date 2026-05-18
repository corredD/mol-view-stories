/**
 * GET /api/dev/docs/<slug> -> { slug, title, content }
 *
 * Slug mirrors the docs/ tree path (without .qmd), so:
 *   /api/dev/docs/getting-started
 *   /api/dev/docs/molviewspec/selectors
 *   /api/dev/docs/example-stories/making-of-mom300
 *
 * Returns the .qmd content as-is (Quarto markdown). Callout blocks like
 * ::: {.callout-tip} are kept; they read fine as plain markdown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';
import { readDoc } from '@/lib/dev-references';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ slug: string[] }> }) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  void auth.sessionId;
  const { slug: parts } = await context.params;
  const slug = (parts ?? []).join('/');
  if (!slug) return NextResponse.json({ error: 'missing slug' }, { status: 400 });
  const doc = readDoc(slug);
  if (!doc) return NextResponse.json({ error: `unknown doc slug: ${slug}` }, { status: 404 });
  return NextResponse.json(doc);
}
