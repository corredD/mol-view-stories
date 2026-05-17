import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled, readStory, patchStory, writeStory, Story } from '@/lib/dev-store';
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
  return NextResponse.json(await readStory(auth.sessionId));
}

export async function PATCH(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const body = (await req.json()) as Partial<Story>;
  const { title, author_note, story_js, settings } = body;
  const patched = await patchStory(auth.sessionId, { title, author_note, story_js, settings });
  return NextResponse.json(patched);
}

export async function PUT(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const body = (await req.json()) as Story;
  return NextResponse.json(await writeStory(auth.sessionId, body));
}
