/**
 * Validate scene JS by running it against a real MVS builder.
 *
 * POST /api/dev/validate
 *   body: { story_js?: string, scene_js: string }
 *   -> { ok: true, mvsj: <opaque snapshot> }
 *      | { ok: false, error: { message, line?, column?, stack? } }
 *
 * The webapp itself does this when you click Apply, but doing it here means
 * Claude can run it without round-tripping through the user's mouse, and the
 * error returned is structured (not a screenshot of red squiggles).
 */

import { NextRequest, NextResponse } from 'next/server';
import vm from 'node:vm';
import { isDevEnabled } from '@/lib/dev-store';
import { requireSession } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

interface ValidateBody {
  story_js?: string;
  scene_js: string;
}

interface ValidateError {
  message: string;
  name?: string;
  line?: number;
  column?: number;
  stack?: string;
}

function parseErrorLocation(err: Error): Pick<ValidateError, 'line' | 'column'> {
  // Node's V8 stack frames look like: "  at scene.js:12:7"
  const m = err.stack?.match(/scene\.js:(\d+):(\d+)/);
  if (!m) return {};
  return { line: Number(m[1]), column: Number(m[2]) };
}

export async function POST(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = requireSession(req);
  if ('error' in auth) return auth.error;
  void auth.sessionId;
  const { story_js = '', scene_js } = (await req.json()) as ValidateBody;

  if (typeof scene_js !== 'string') {
    return NextResponse.json({ error: 'scene_js must be a string' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mvs: any;
  try {
    mvs = await import('molstar/lib/extensions/mvs/mvs-data');
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: { message: `failed to import builder: ${(err as Error).message}` } },
      { status: 500 }
    );
  }

  const builder = mvs.MVSData.createBuilder();

  // Build a sandbox with the same global symbols the webapp exposes to
  // scene code. (See the StoryManager / scene-runner for the canonical list.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linearAlgebra: any = await import('molstar/lib/mol-math/linear-algebra').catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const molScript: any = await import('molstar/lib/mol-script/language/builder').catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mvsHelpers: any = await import('molstar/lib/extensions/mvs/helpers/utils').catch(() => ({}));

  const sandbox = vm.createContext({
    builder,
    Vec3: linearAlgebra.Vec3,
    Vec4: linearAlgebra.Vec4,
    Mat3: linearAlgebra.Mat3,
    Mat4: linearAlgebra.Mat4,
    Quat: linearAlgebra.Quat,
    MS: molScript.MolScriptBuilder ?? molScript.default,
    decodeColor: mvsHelpers.decodeColor,
    console,
  });

  try {
    // Run story_js first (defines helpers), then scene_js.
    const combined = `${story_js}\n;//---scene---\n${scene_js}`;
    const script = new vm.Script(combined, { filename: 'scene.js' });
    script.runInContext(sandbox, { timeout: 5000 });

    // Serialize the result via the builder's getState() / MVSData.toMVSJ().
    const state = builder.getState();
    const mvsj = mvs.MVSData.toMVSJ(state);
    return NextResponse.json({ ok: true, mvsj: JSON.parse(mvsj) });
  } catch (err) {
    const e = err as Error;
    const loc = parseErrorLocation(e);
    const payload: { ok: false; error: ValidateError } = {
      ok: false,
      error: {
        name: e.name,
        message: e.message,
        stack: e.stack,
        ...loc,
      },
    };
    return NextResponse.json(payload, { status: 200 });
  }
}
