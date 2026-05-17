/**
 * Builder introspection.
 *
 * GET /api/dev/builder
 *   -> { nodes: { root: { methods: [...] }, structure: { methods: [...] }, ... } }
 *
 * GET /api/dev/builder?node=primitives
 *   -> { node: 'primitives', methods: [...] }
 *
 * GET /api/dev/builder?node=primitives&method=distance
 *   -> { node, method, signature: { params: [...] } }
 *
 * The point of this endpoint: the MCP server (and therefore Claude) can ask
 * "what methods does the primitives node actually have?" and never has to
 * guess at a name again. We do this by actually instantiating a real builder
 * with the installed molstar package, since that's the only source of truth
 * that doesn't lie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { requireUser } from '@/lib/dev-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

// Lazy import so the route isn't paid for in production.
async function getBuilderSnapshot() {
  // molstar exposes the MVS builder via PluginExtensions.mvs.MVSData.createBuilder()
  // in the browser bundle, but server-side we go through the lib/ entry points.
  // The actual import path is the same module the webapp already depends on.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mvs: any = await import('molstar/lib/extensions/mvs/mvs-data');
  const root = mvs.MVSData.createBuilder();

  const structure = root
    .download({ url: 'about:blank' })
    .parse({ format: 'mmcif' })
    .modelStructure({});
  const component = structure.component({ selector: 'all' });
  const representation = component.representation({ type: 'cartoon' });
  const volume = root.download({ url: 'about:blank' }).parse({ format: 'bcif' }).volume({});
  const primitives = root.primitives({});
  const structurePrimitives = structure.primitives({});
  const animation = root.animation({});

  return {
    root,
    structure,
    component,
    representation,
    volume,
    primitives,
    structure_primitives: structurePrimitives,
    animation,
  };
}

function methodsOf(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const seen = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(obj);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && typeof desc.value === 'function') seen.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  // Plus own enumerable function props (the builder uses class fields a lot).
  for (const name of Object.keys(obj)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (obj as any)[name] === 'function') seen.add(name);
  }
  return [...seen].sort();
}

function signatureOf(obj: unknown, methodName: string): { params: string[]; source: string } | null {
  if (!obj || typeof obj !== 'object') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (obj as any)[methodName];
  if (typeof fn !== 'function') return null;
  const src = fn.toString();
  // Best-effort param extraction from the function's source.
  const m = src.match(/^[^(]*\(([^)]*)\)/);
  const params = m ? m[1].split(',').map((p: string) => p.trim()).filter(Boolean) : [];
  // Truncate the source to keep responses small.
  return { params, source: src.slice(0, 600) };
}

export async function GET(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const auth = await requireUser(req);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const node = url.searchParams.get('node');
  const method = url.searchParams.get('method');

  let snap: Awaited<ReturnType<typeof getBuilderSnapshot>>;
  try {
    snap = await getBuilderSnapshot();
  } catch (err: unknown) {
    return NextResponse.json(
      { error: 'failed to instantiate builder', detail: (err as Error).message },
      { status: 500 }
    );
  }

  if (node && method) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = (snap as any)[node];
    if (!obj) return NextResponse.json({ error: `unknown node ${node}` }, { status: 404 });
    const sig = signatureOf(obj, method);
    if (!sig) return NextResponse.json({ error: `${node} has no method ${method}` }, { status: 404 });
    return NextResponse.json({ node, method, ...sig });
  }

  if (node) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = (snap as any)[node];
    if (!obj) return NextResponse.json({ error: `unknown node ${node}` }, { status: 404 });
    return NextResponse.json({ node, methods: methodsOf(obj) });
  }

  const all: Record<string, { methods: string[] }> = {};
  for (const [k, v] of Object.entries(snap)) {
    all[k] = { methods: methodsOf(v) };
  }
  return NextResponse.json({ nodes: all });
}
