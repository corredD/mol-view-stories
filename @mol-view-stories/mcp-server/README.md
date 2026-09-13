# @mol-view-stories/mcp-server

A stdio MCP server that lets Claude (in Claude Code or Claude Desktop) drive a
locally running `mol-view-stories` editor directly. No more pasting, no more
guessing builder method names, no more silent UI breakage.

```
┌─────────────────────┐  stdio  ┌──────────────────┐  HTTP  ┌────────────────────────┐
│ Claude Code/Desktop │ ──────► │ mvs-mcp          │ ─────► │ @mol-view-stories/     │
│                     │         │ (this package)   │        │ webapp  (dev mode)     │
└─────────────────────┘         └──────────────────┘        └────────────────────────┘
                                                                       │
                                                                       ▼
                                                             .mvs-dev/story.json
                                                             (source of truth)
```

This package lives inside the `mol-view-stories` repo on purpose: every tool is a
thin wrapper over an `/api/dev/*` route in the webapp, and those routes are
fork-local (they do not exist on `upstream/main`). Keeping both in one repo means
a route change and its tool change land in the same commit.

## Setup

### 1. Enable the dev API in the webapp

The dev routes are gated behind an env flag; without it they 404.

```bash
# from the repo root
cat >> .env.local <<'EOF'
NEXT_PUBLIC_DEV_API=1
MVS_DEV_STORE=./.mvs-dev/story.json
EOF

pnpm install
pnpm dev:web        # http://localhost:3000
```

Sanity-check the backend before debugging anything in the MCP layer:

```bash
curl http://localhost:3000/api/dev/story
curl 'http://localhost:3000/api/dev/builder?node=primitives'
```

The second call returns the real list of methods on the primitives builder. That
alone settles the "is it `distance_measurement` or `distanceMeasurement`?"
question definitively.

### 2. Build this server

```bash
# from the repo root
pnpm --filter @mol-view-stories/mcp-server build
```

This produces `dist/index.js` (gitignored). Rebuild after every edit to
`src/index.ts` — the registered binary is what the Claude client launches, so an
unbuilt edit changes nothing.

### 3. Register it

**Claude Code:**

```bash
claude mcp add mvs \
  --env MVS_DEV_URL=http://localhost:3000 \
  -- node /absolute/path/to/mol-view-stories/@mol-view-stories/mcp-server/dist/index.js
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mvs": {
      "command": "node",
      "args": ["/absolute/path/to/mol-view-stories/@mol-view-stories/mcp-server/dist/index.js"],
      "env": { "MVS_DEV_URL": "http://localhost:3000" }
    }
  }
}
```

Restart the Claude client afterwards.

## Usage

With the webapp running and the server registered, start a conversation and try:

> What scenes are in my current story?

Claude calls `story_get` and `scenes_list`, then can go on to `scene_create`,
`scene_set`, `scene_validate` and the rest. As it makes changes the dev store
updates on disk and the `DevSyncMount` component refreshes the browser editor
within a couple of seconds.

When Claude is unsure how to call a primitive it should call
`builder_list_methods` first. That is the whole point of having a live MCP into
the real builder.

## Tool reference

19 tools. See `SKILLS.md` for the MVS-scripting reference the server hands to
agents, and `CLAUDE.md` for how the code is organised.

| Tool | Purpose |
|---|---|
| `auth_set` / `auth_status` | Set / inspect the dev session identity |
| `story_get` | Read current story + scenes list |
| `story_set_metadata` | Patch title, author_note, settings, story-wide JS |
| `scenes_list` | List scene keys and timing |
| `scene_get` | Read one scene (md + js + timing) |
| `scene_create` | Create a new scene |
| `scene_set` | Update a scene's md/js/timing |
| `scene_delete` | Remove a scene |
| `scenes_reorder` | Reorder scenes by key list |
| `scene_validate` | Run scene JS through the real builder, return MVSJ or error |
| `builder_list_methods` | Introspect the real MVS builder method surface |
| `mvs_types_get` | Fetch the generated MVS type definitions |
| `mvs_doc_list` / `mvs_doc_get` | Browse the MolViewSpec docs |
| `example_list` / `example_get` / `example_load` | Browse and load bundled examples |
| `story_export` | Produce `.mvsj` / `.mvsx` / folder layout |

## Safety

- All dev routes are gated by `NEXT_PUBLIC_DEV_API=1`. Without it they 404.
- The Next.js dev server binds to 127.0.0.1 by default; do not bind to 0.0.0.0
  unless you understand the implications.
- This server is stdio only. Nothing is exposed to the network.

## Troubleshooting

**`fetch failed`** — the webapp isn't running, or `MVS_DEV_URL` points somewhere
wrong. Default is `http://localhost:3000`.

**`builder.primitives is not a function`** when validating — the `molstar` in
`node_modules` is older than the dev routes expect. Check the root
`package.json`.

**A node kind or parse format the builder should support is missing** — the
installed `molstar` may predate it. Some MVS features exist on molstar's
`upstream/master` but are not in any published release; in that case the
workspace-level `make link` against a local molstar checkout is required.

**Editor doesn't refresh when Claude makes changes** — `DevSyncMount` is not
mounted in the editor layout.

**`/api/dev/builder` 500s** — the molstar lib import path may have moved. Open
the route and adjust; molstar's CHANGELOG is the authoritative reference.
