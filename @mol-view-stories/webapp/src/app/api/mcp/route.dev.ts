/**
 * POST /api/mcp/ — Model Context Protocol over Streamable HTTP.
 *
 * This is the supported way to connect an agent to the editor:
 *
 *   claude mcp add --transport http mvs https://<host>/<basePath>/api/mcp/
 *
 * No clone, no npm install, no build, no absolute paths in a JSON config, and no
 * version skew — the tools and the `/api/dev/*` routes they wrap ship together
 * because they are the same deployment.
 *
 * Transport notes, all verified against the Claude Code client on 2026-09-13:
 *
 *  - The client echoes `Mcp-Session-Id` on every request after `initialize`, so
 *    the MCP session id doubles as the dev-store key. `initialize` itself never
 *    carries one, which is why a fresh client process always gets a fresh story.
 *  - `notifications/*` carry no id and MUST get 202 with an empty body; sending
 *    a JSON-RPC envelope back makes clients hang.
 *  - The client opens a GET for the SSE stream. We have no server-initiated
 *    messages, so 405 is the correct, and harmless, answer.
 *  - It probes a non-standard `server/discover` method before initialize; -32601
 *    is fine.
 *
 * Written by hand rather than via the SDK's StreamableHTTPServerTransport: that
 * transport expects Node's req/res, while App Router hands us Web Request and
 * Response. For a stateless server with no SSE the protocol is a small switch,
 * and this keeps the route dependency-free.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevEnabled } from '@/lib/dev-store';
import { mintSession, revokeSession, touchSession } from '@/lib/dev-auth';
import { MCP_INSTRUCTIONS } from '@/lib/mcp/instructions';
import { MCP_TOOLS, MCP_TOOL_BY_NAME, type McpToolContext } from '@/lib/mcp/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVER_INFO = { name: 'mol-view-stories', version: '0.2.0' };
const FALLBACK_PROTOCOL_VERSION = '2025-06-18';

function notFound() {
  return new NextResponse('Not Found', { status: 404 });
}

// ─── JSON-RPC plumbing ────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const ok = (id: JsonRpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const fail = (id: JsonRpcRequest['id'], code: number, message: string) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  error: { code, message },
});

// ─── Session + URL resolution ─────────────────────────────────────────────

/**
 * Resolve the dev-store key for this request.
 *
 * An explicit bearer token wins: that is a user who installed the server with
 * `--header "Authorization: Bearer <token>"` to pin a stable story across
 * conversations. Otherwise we use the MCP session id the client echoes back.
 */
function resolveSession(req: NextRequest): { sessionId: string; minted: boolean } | null {
  const auth = req.headers.get('authorization');
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && touchSession(bearer)) return { sessionId: bearer, minted: false };

  const mcpSessionId = req.headers.get('mcp-session-id');
  if (mcpSessionId && touchSession(mcpSessionId)) return { sessionId: mcpSessionId, minted: false };

  return null;
}

/**
 * Origin + basePath as the *user's browser* would reach it, for links we hand
 * back (the pairing URL, export downloads). Behind the reverse proxy in front of
 * this app, the forwarded headers are the only accurate source.
 */
function publicBaseUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ?? req.headers.get('host');
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  if (host) return `${proto ?? 'https'}://${host}${basePath}`;
  return `${req.nextUrl.origin}${basePath}`;
}

// ─── Method dispatch ──────────────────────────────────────────────────────

async function dispatch(msg: JsonRpcRequest, ctx: McpToolContext): Promise<unknown> {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? FALLBACK_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });

    case 'ping':
      return ok(msg.id, {});

    case 'tools/list':
      return ok(msg.id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const name = msg.params?.name as string;
      const tool = MCP_TOOL_BY_NAME.get(name);
      if (!tool) {
        return ok(msg.id, {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        });
      }
      try {
        const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
        const text = await tool.handler(args, ctx);
        return ok(msg.id, { content: [{ type: 'text', text }] });
      } catch (err) {
        // Tool failures are results, not protocol errors — the model needs to
        // read the message and correct itself rather than see the call vanish.
        return ok(msg.id, {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        });
      }
    }

    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// ─── HTTP surface ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isDevEnabled()) return notFound();

  let payload: JsonRpcRequest | JsonRpcRequest[];
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, 'Parse error'), { status: 400 });
  }

  const batch = Array.isArray(payload) ? payload : [payload];

  // Notifications carry no id. A batch of only notifications gets 202/empty.
  const hasRequest = batch.some((m) => m && m.id !== undefined && m.id !== null);
  if (!hasRequest) return new NextResponse(null, { status: 202 });

  const isInitialize = batch.some((m) => m?.method === 'initialize');
  const existing = resolveSession(req);

  // A client that has never connected arrives at initialize with no session, so
  // this is where a story slot is born. Anything else without a valid session is
  // a client whose session we have forgotten (restart, or 24h idle TTL).
  let sessionId: string;
  let mintedNow = false;
  if (existing) {
    sessionId = existing.sessionId;
  } else if (isInitialize) {
    sessionId = mintSession().id;
    mintedNow = true;
  } else {
    return NextResponse.json(
      fail(
        batch.find((m) => m.id != null)?.id ?? null,
        -32001,
        'Session expired or unknown. Reconnect the MCP server to start a new editing session.'
      ),
      { status: 404 }
    );
  }

  const ctx: McpToolContext = { sessionId, publicBaseUrl: publicBaseUrl(req) };
  const results = await Promise.all(batch.filter((m) => m?.id != null).map((m) => dispatch(m, ctx)));
  const body = Array.isArray(payload) ? results : results[0];

  return NextResponse.json(body, {
    status: 200,
    headers: {
      // Returned on initialize; the client echoes it on every later request.
      ...(mintedNow || isInitialize ? { 'Mcp-Session-Id': sessionId } : {}),
      'Cache-Control': 'no-store',
    },
  });
}

/** No server-initiated messages, so there is no SSE stream to open. */
export async function GET() {
  if (!isDevEnabled()) return notFound();
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST, DELETE' } });
}

/** Spec-defined way for a client to end its session. */
export async function DELETE(req: NextRequest) {
  if (!isDevEnabled()) return notFound();
  const existing = resolveSession(req);
  if (existing) revokeSession(existing.sessionId);
  return new NextResponse(null, { status: 204 });
}
