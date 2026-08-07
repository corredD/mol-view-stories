import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled, readStory, upsertScene, reorderScenes, Scene } from '@/lib/dev-store';
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
  const s = await readStory(auth.sessionId);
  return NextResponse.json(
    s.scenes.map(({ key, name, linger_duration_ms, transition_duration_ms }) => ({
      key,
      name,
      linger_duration_ms,
      transition_duration_ms,
    }))
  );
}

export async function POST(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const sc = (await req.json()) as Scene;
  if (!sc.key || !sc.name) {
    return NextResponse.json({ error: 'key and name are required' }, { status: 400 });
  }
  const story = await upsertScene(auth.sessionId, {
    ...sc,
    description: sc.description ?? '',
    javascript: sc.javascript ?? '',
    linger_duration_ms: sc.linger_duration_ms ?? 1500,
    transition_duration_ms: sc.transition_duration_ms ?? 800,
  });
  return NextResponse.json(story.scenes.find((x) => x.key === sc.key));
}

export async function PATCH(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const { order } = (await req.json()) as { order: string[] };
  return NextResponse.json(await reorderScenes(auth.sessionId, order));
}
