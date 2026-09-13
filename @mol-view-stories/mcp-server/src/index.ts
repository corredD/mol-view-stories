#!/usr/bin/env node
/**
 * mvs-mcp — stdio bridge to a mol-view-stories deployment.
 *
 * The tools themselves no longer live here. They live in the webapp next to the
 * `/api/dev/*` routes they wrap, and are served over Streamable HTTP from
 * `POST <MVS_DEV_URL>/api/mcp/`. This file is the adapter for clients that can
 * only speak stdio: it pumps newline-delimited JSON-RPC between stdin/stdout and
 * that endpoint, and does nothing else.
 *
 * Prefer the remote transport where the client supports it — there is nothing to
 * clone, build, or keep in sync:
 *
 *   claude mcp add --transport http mvs https://<host>/mvs/api/mcp/
 *
 * This bridge exists for Claude Desktop and any other stdio-only client. Because
 * it forwards `initialize` verbatim, it inherits the server's tool list and its
 * `instructions` automatically; it never needs updating when a tool changes.
 *
 * Diagnostics go to stderr only — anything on stdout corrupts the protocol.
 */

import { createInterface } from 'node:readline';

const BASE = (process.env.MVS_DEV_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const ENDPOINT = `${BASE}/api/mcp/`;
const TOKEN = process.env.MVS_DEV_TOKEN?.trim();

// Captured from the initialize response and echoed on every later request; this
// is what keeps the whole conversation pinned to one editing session.
let mcpSessionId: string | null = null;

const log = (msg: string) => process.stderr.write(`mvs-mcp: ${msg}\n`);
const send = (obj: unknown) => process.stdout.write(`${JSON.stringify(obj)}\n`);

async function forward(message: Record<string, unknown>): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;
  // An explicit token pins a stable story across conversations; without one the
  // server mints a session on initialize and we adopt whatever it returns.
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(message) });
  } catch (err) {
    log(`cannot reach ${ENDPOINT}: ${(err as Error).message}`);
    if (message.id !== undefined && message.id !== null) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32001, message: `Cannot reach MVS server at ${BASE}. Is MVS_DEV_URL correct?` },
      });
    }
    return;
  }

  const returned = res.headers.get('mcp-session-id');
  if (returned) mcpSessionId = returned;

  // 202 is the correct answer to a notification: no body, nothing to write back.
  if (res.status === 202 || res.status === 204) return;

  const text = await res.text();
  if (!text) return;

  try {
    send(JSON.parse(text));
  } catch {
    log(`non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    if (message.id !== undefined && message.id !== null) {
      send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32603, message: `Bad response from ${ENDPOINT} (HTTP ${res.status})` },
      });
    }
  }
}

// Requests are forwarded in order: a client may depend on initialize completing
// before the next call, and that is also how we learn the session id.
let queue: Promise<void> = Promise.resolve();

createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(trimmed);
  } catch {
    log(`ignoring unparseable line: ${trimmed.slice(0, 120)}`);
    return;
  }
  queue = queue
    .then(() => forward(message))
    .catch((err: Error) => {
      log(`forward failed: ${err.message}`);
    });
});

log(`bridging stdio -> ${ENDPOINT}`);
