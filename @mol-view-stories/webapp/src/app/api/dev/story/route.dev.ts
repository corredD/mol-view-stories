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
  // Only forward fields the client actually sent — destructuring with default
  // undefined would clobber existing values via the spread in patchStory.
  // `scenes` and `updatedAt` are intentionally not patchable here (scenes have
  // their own routes, updatedAt is server-owned).
  const patch: Partial<Story> = {};
  if ('title' in body) patch.title = body.title;
  if ('author_note' in body) patch.author_note = body.author_note;
  if ('story_js' in body) patch.story_js = body.story_js;
  if ('settings' in body) patch.settings = body.settings;
  return NextResponse.json(await patchStory(auth.sessionId, patch));
}

export async function PUT(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const body = (await req.json()) as Story;
  return NextResponse.json(await writeStory(auth.sessionId, body));
}
