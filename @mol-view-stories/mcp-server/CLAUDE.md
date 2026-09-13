# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
package. It is the `@mol-view-stories/mcp-server` workspace package; the repo-wide guidance is
in the root `CLAUDE.md`.

## Commands

Run from the repo root so pnpm resolves the workspace, or from this directory with `pnpm`:

```bash
pnpm --filter @mol-view-stories/mcp-server build   # tsc -> dist/index.js (the bin entry)
pnpm --filter @mol-view-stories/mcp-server dev     # tsx src/index.ts (stdio server directly)
pnpm --filter @mol-view-stories/mcp-server start   # node dist/index.js (post-build)
```

There is no test suite. Formatting and typechecking come from the workspace gates —
`pnpm prettier:check` and `pnpm tsc:check` at the root cover this package via
`--filter=*`, so run them before opening a PR.

After editing `src/index.ts`, run the `build` above to refresh `dist/` — the registered MCP
binary (`dist/index.js`) is what Claude clients actually launch, so an unbuilt edit changes
nothing. `dist/` is gitignored.

The webapp that serves the dev API now lives in the same repo, so the end-to-end loop is
`pnpm dev:web` in one terminal and this server in another. It needs `NEXT_PUBLIC_DEV_API=1`
in `.env.local` and listens on `MVS_DEV_URL` (default `http://localhost:3000`).
Sanity-check the backend before debugging the MCP layer:

```bash
curl http://localhost:3000/api/dev/story
curl 'http://localhost:3000/api/dev/builder?node=primitives'
```

## Architecture

```
Claude client ──stdio──> mvs-mcp (this package) ──HTTP──> @mol-view-stories/webapp ──> .mvs-dev/story.json
```

The MCP server is intentionally thin: every tool is a wrapper around an HTTP call to a
`/api/dev/*` route in the webapp. The real MolViewSpec builder, the persistent store, and the
schema for stories/scenes all live in
`@mol-view-stories/webapp/src/app/api/dev/` (route files are `route.dev.ts`), not here.
**When a tool's behavior is wrong, the fix is almost always in those routes, not in
`src/index.ts`.**

Because the server and the routes it wraps are now versioned together in one repo, a route
rename and its tool update belong in the same commit.

### `src/index.ts` — the entire server

Everything is in one file:

1. **`api<T>()`** — shared `fetch` helper that prepends `MVS_DEV_URL` and throws on non-2xx with the response body.
2. **`defineTool()` registry** — each tool is a `{ name, description, inputSchema (zod), handler }` object pushed into a `tools[]` array.
3. **Two request handlers** — `ListToolsRequestSchema` exposes the registry, `CallToolRequestSchema` looks up the tool, parses args through its zod schema, and returns the handler's string output wrapped in MCP content.
4. **`zodToJsonSchema()`** — a deliberately minimal in-file converter (object/string/number/boolean/array/enum/optional/effects). No external dep. If you add a tool that needs a zod type not handled here, extend this function rather than pulling in `zod-to-json-schema`.
5. **Stdio transport boot** — connects `StdioServerTransport` and logs the target URL. Stdio MCP servers cannot use `console.log`; **all diagnostics must go to `process.stderr`**, otherwise they corrupt the protocol stream.

### Tool surface (and what the descriptions are doing)

The 19 tools cover auth, story-level CRUD, scene-level CRUD, validation, builder introspection, and export. The tool **descriptions** are prompt-engineered for the LLM caller — e.g. `story_get` tells Claude to "Always start a session with this", `builder_list_methods` tells Claude to call it "BEFORE writing builder code so you never guess at a method name." When editing descriptions, preserve this directive style; they are the only documentation the upstream Claude sees.

Two tools have non-trivial logic beyond a single HTTP call and are worth understanding before editing:

- **`scene_validate`** — accepts either `key` (validate the saved scene) or inline `scene_js` (preview without saving). If only `key` is given it fetches the scene's JS first; if `story_js` is omitted it fetches the current story-wide JS so the validation matches what the editor would actually run.
- **`story_export`** — the webapp returns three different payload shapes per `format` (`mvsj` string, `mvsx` base64, `folder` map). The handler dispatches on `res.format`, writes to `out_dir` if given (creating subdirs for folder exports, base64-decoding for mvsx), and otherwise returns a size summary to avoid dumping large content back through the MCP channel.

### Environment

- `MVS_DEV_URL` — base URL of the webapp. Defaults to `http://localhost:3000`.

Register the built binary with a Claude client by absolute path, e.g.

```bash
claude mcp add mvs -- node /absolute/path/to/mol-view-stories/@mol-view-stories/mcp-server/dist/index.js
```
