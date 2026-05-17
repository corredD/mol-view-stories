/**
 * Export the current dev store as a finished story.
 *
 * POST /api/dev/export
 *   body: { format: 'mvsj' | 'mvsx' | 'folder' }
 *   -> { ok: true, format, content?: string, files?: Record<string,string> }
 *
 * For mvsj: returns the JSON string.
 * For mvsx: returns base64 of the zip.
 * For folder: returns a map of relative_path -> file contents (so the MCP
 *   server can write the folder layout to disk itself).
 */

import { NextRequest, NextResponse } from 'next/server';
import vm from 'node:vm';
import { isDevEnabled, readStory } from '@/lib/dev-store';
import { requireUser } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

export async function POST(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = await requireUser(req);
  if ('error' in auth) return auth.error;
  const { format } = (await req.json()) as { format: 'mvsj' | 'mvsx' | 'folder' };
  const story = await readStory(auth.userId);

  if (format === 'folder') {
    const files: Record<string, string> = {};
    files['story.yaml'] = renderStoryYaml(story);
    if (story.story_js.trim()) files['story.js'] = story.story_js;
    for (const sc of story.scenes) {
      const base = `scenes/${sc.key}`;
      files[`${base}/${sc.key}.yaml`] = renderSceneYaml(sc);
      files[`${base}/${sc.key}.md`] = sc.description ?? '';
      files[`${base}/${sc.key}.js`] = sc.javascript ?? '';
    }
    return NextResponse.json({ ok: true, format, files });
  }

  // For mvsj/mvsx we have to actually build the multistate snapshot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mvs: any = await import('molstar/lib/extensions/mvs/mvs-data');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linearAlgebra: any = await import('molstar/lib/mol-math/linear-algebra').catch(() => ({}));

  const snapshots = [];
  for (const sc of story.scenes) {
    const builder = mvs.MVSData.createBuilder();
    const sandbox = vm.createContext({
      builder,
      Vec3: linearAlgebra.Vec3,
      Mat4: linearAlgebra.Mat4,
      Mat3: linearAlgebra.Mat3,
      Quat: linearAlgebra.Quat,
      console,
    });
    try {
      const combined = `${story.story_js}\n;//---scene---\n${sc.javascript}`;
      new vm.Script(combined, { filename: `${sc.key}.js` }).runInContext(sandbox, { timeout: 5000 });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: { scene: sc.key, message: (err as Error).message } },
        { status: 200 }
      );
    }
    const snap = builder.getSnapshot({
      title: sc.name,
      description: sc.description,
      linger_duration_ms: sc.linger_duration_ms,
      transition_duration_ms: sc.transition_duration_ms,
    });
    snapshots.push(snap);
  }

  const multistate = mvs.MVSData.createMultistate(snapshots, {
    title: story.title,
    description: story.author_note,
  });

  if (format === 'mvsj') {
    return NextResponse.json({ ok: true, format, content: mvs.MVSData.toMVSJ(multistate, 2) });
  }
  // mvsx
  const bin: Uint8Array = await mvs.MVSData.toMVSX(multistate);
  const b64 = Buffer.from(bin).toString('base64');
  return NextResponse.json({ ok: true, format, content_base64: b64 });
}

function renderStoryYaml(story: ReturnType<typeof readStory> extends Promise<infer T> ? T : never): string {
  const lines: string[] = [];
  lines.push(`title: ${JSON.stringify(story.title)}`);
  if (story.author_note) lines.push(`author_note: ${JSON.stringify(story.author_note)}`);
  if (story.settings) {
    lines.push('settings:');
    for (const [k, v] of Object.entries(story.settings)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push('scenes:');
  for (const sc of story.scenes) {
    lines.push(`  - folder: ${sc.key}`);
  }
  return lines.join('\n') + '\n';
}

function renderSceneYaml(
  sc: { key: string; name: string; linger_duration_ms?: number; transition_duration_ms?: number }
): string {
  const lines: string[] = [];
  lines.push(`name: ${JSON.stringify(sc.name)}`);
  lines.push(`key: ${JSON.stringify(sc.key)}`);
  if (sc.linger_duration_ms != null) lines.push(`linger_duration_ms: ${sc.linger_duration_ms}`);
  if (sc.transition_duration_ms != null)
    lines.push(`transition_duration_ms: ${sc.transition_duration_ms}`);
  return lines.join('\n') + '\n';
}
