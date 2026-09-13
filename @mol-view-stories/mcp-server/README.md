# @mol-view-stories/mcp-server

A stdio bridge to a mol-view-stories MCP endpoint.

**Most people do not need this package.** The MCP server is hosted by the webapp
itself, so connecting an agent is one command:

```bash
claude mcp add --transport http mvs https://mesoscope.scripps.edu/mvs/api/mcp/
```

Nothing to clone, nothing to build, no absolute paths in a JSON config, and no
version skew — the tools and the `/api/dev/*` routes they wrap are the same
deployment. See `@mol-view-stories/webapp/src/app/api/mcp/route.dev.ts`.

## What this package is for

Clients that can only launch a subprocess and speak stdio (Claude Desktop, and
anything else without Streamable HTTP support). It pumps newline-delimited
JSON-RPC between stdin/stdout and `POST $MVS_DEV_URL/api/mcp/` and does nothing
else — no tool definitions, no schemas, no dependencies.

Because it forwards `initialize` verbatim, it inherits the server's tool list and
its `instructions` automatically. **A tool change never requires rebuilding this
bridge.**

```
┌──────────────────┐  stdio  ┌────────────┐  HTTP  ┌──────────────────────────┐
│ stdio-only client│ ──────► │ this bridge│ ─────► │ webapp  POST /api/mcp/   │
└──────────────────┘         └────────────┘        │ (tools live here)        │
                                                   └──────────────────────────┘
```

### Setup

```bash
pnpm --filter @mol-view-stories/mcp-server build   # -> dist/index.js
```

```json
{
  "mcpServers": {
    "mvs": {
      "command": "node",
      "args": ["/absolute/path/to/@mol-view-stories/mcp-server/dist/index.js"],
      "env": { "MVS_DEV_URL": "https://mesoscope.scripps.edu/mvs" }
    }
  }
}
```

| Env | Meaning |
|---|---|
| `MVS_DEV_URL` | Base URL of the deployment. Default `http://localhost:3000`. |
| `MVS_DEV_TOKEN` | Optional. Pins every conversation to one existing session (see below). |

## How a session works

A fresh connection mints a fresh, empty story. The server returns its id as
`Mcp-Session-Id` on `initialize`; the client echoes it on every later request,
and that id is the dev-store key.

To let the user *watch*, the agent calls `editor_open` and hands back a URL
ending in `#mcp-session=<id>`. Opening it makes the browser tab adopt that
session, so both ends share one editing slot with nothing copied by hand.

Set `MVS_DEV_TOKEN` (or install with `--header "Authorization: Bearer <token>"`)
to reuse one specific session across conversations instead. Grab the token from
**Pin this editing session** in the app's MCP menu.

## Local development

```bash
# terminal 1 — the webapp, which is where the tools actually live
pnpm dev:web                     # needs NEXT_PUBLIC_DEV_API=1

# terminal 2 — talk to the endpoint directly, no bridge needed
curl -s -X POST http://localhost:3000/api/mcp/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`SKILLS.md` in this directory is the MVS-scripting reference the server hands to
agents via the `mvs_skill_get` tool. It is bundled into the webapp at build time
by `pnpm --filter @mol-view-stories/webapp gen:skill`, so **edit it here and the
webapp picks it up on its next build.**

## Where to fix things

| Symptom | Where |
|---|---|
| A tool behaves wrongly | the `/api/dev/*` route it wraps |
| A tool is missing, or its description is bad | `webapp/src/lib/mcp/tools.ts` |
| The agent doesn't follow the right workflow | `webapp/src/lib/mcp/instructions.ts` |
| MVS scripting guidance is wrong | `SKILLS.md` (here) |
| Transport/protocol issue | `webapp/src/app/api/mcp/route.dev.ts` |
| stdio-specific issue only | `src/index.ts` (this bridge) |
