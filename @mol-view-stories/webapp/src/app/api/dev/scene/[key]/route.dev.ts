import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled, readStory, upsertScene, deleteScene, Scene } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const { key } = await context.params;
  const story = await readStory(auth.sessionId);
  const scene = story.scenes.find((s) => s.key === key);
  if (!scene) return NextResponse.json({ error: 'scene not found' }, { status: 404 });
  return NextResponse.json(scene);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const { key } = await context.params;
  const body = (await req.json()) as Partial<Scene>;
  const story = await readStory(auth.sessionId);
  const existing = story.scenes.find((s) => s.key === key);
  const merged: Scene = {
    key,
    name: body.name ?? existing?.name ?? key,
    description: body.description ?? existing?.description ?? '',
    javascript: body.javascript ?? existing?.javascript ?? '',
    linger_duration_ms: body.linger_duration_ms ?? existing?.linger_duration_ms,
    transition_duration_ms: body.transition_duration_ms ?? existing?.transition_duration_ms,
    camera: body.camera ?? existing?.camera,
  };
  const next = await upsertScene(auth.sessionId, merged);
  return NextResponse.json(next.scenes.find((s) => s.key === key));
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  const { key } = await context.params;
  return NextResponse.json(await deleteScene(auth.sessionId, key));
}
