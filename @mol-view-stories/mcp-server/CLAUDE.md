# CLAUDE.md

Guidance for `@mol-view-stories/mcp-server`. Repo-wide guidance is in the root
`CLAUDE.md`.

## This package is now a bridge, not the server

The MCP tools used to live here. They don't any more. **They live in the webapp**,
served over Streamable HTTP from `POST /api/mcp/`:

| What | Where |
|---|---|
| Tool registry (names, schemas, descriptions, handlers) | `webapp/src/lib/mcp/tools.ts` |
| `initialize` instructions handed to the agent | `webapp/src/lib/mcp/instructions.ts` |
| Transport / JSON-RPC | `webapp/src/app/api/mcp/route.dev.ts` |
| MVS scripting reference (`mvs_skill_get`) | `SKILLS.md` here, bundled by `webapp/scripts/gen-skill.mjs` |
| This package | `src/index.ts` — ~95 lines of stdio↔HTTP pump |

They moved because the tools wrap fork-local `/api/dev/*` routes and must version
with them; co-locating makes that automatic instead of a discipline. **Do not
re-add tool definitions here.** The bridge forwards `initialize` verbatim, so it
inherits the tool list and instructions for free and needs no edit when a tool
changes.

## Commands

```bash
pnpm --filter @mol-view-stories/mcp-server build   # tsc -> dist/index.js
pnpm --filter @mol-view-stories/mcp-server dev     # tsx src/index.ts
```

No tests. `pnpm tsc:check` and `pnpm prettier:check` at the root cover this
package via `--filter=*`.

The package has **no runtime dependencies** — not even the MCP SDK. It speaks
raw JSON-RPC over `fetch`. Keep it that way; the whole point is that a
stdio-only client can run it with nothing installed.

## Editing SKILLS.md

`SKILLS.md` is the long-form MVS-scripting reference served by the `mvs_skill_get`
tool. It is **not** read from disk at runtime — a `next build --output standalone`
deploy ships no source tree, so runtime reads of repo files fail there. Instead
`webapp/scripts/gen-skill.mjs` compiles it into `webapp/src/lib/mcp/skill.generated.ts`,
and that runs automatically before `dev` and `build`.

So: edit `SKILLS.md` here, then rebuild the webapp. Never edit
`skill.generated.ts`.

That same standalone-deploy constraint is why `docs/` and `cli/examples/` are
resolved through `MVS_REFERENCE_ROOT` (see `webapp/src/lib/dev-references.ts`).
Reading repo files at runtime is the recurring trap in this codebase.

## Debugging

Stdout is the protocol stream. **All diagnostics must go to stderr** — a stray
`console.log` corrupts the session.

Skip the bridge when isolating a problem; talk to the endpoint directly:

```bash
curl -s -X POST http://localhost:3000/api/mcp/ \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

If that works and the bridge doesn't, the bug is here. Otherwise it is in the
webapp.

Verified client behaviour (Claude Code, 2026-09-13), worth knowing before
changing the transport:

- The client echoes `Mcp-Session-Id` on every request after `initialize`, which
  is what makes the MCP session usable as the dev-store key.
- `initialize` never carries an inbound session id, so each client process gets a
  fresh story unless pinned with `MVS_DEV_TOKEN` / an `Authorization` header.
- Notifications must get **202 with an empty body**; a JSON-RPC envelope hangs.
- The client opens a `GET` for SSE and follows 308 redirects on POST with body
  and headers intact.
