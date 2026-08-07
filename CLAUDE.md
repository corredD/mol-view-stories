# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a pnpm + Deno + Python multi-package repo, not a single app.

- `@mol-view-stories/webapp` — Next.js 15 / React 19 frontend (the editor at `https://molstar.org/mol-view-stories`). Static-exported in production.
- `@mol-view-stories/lib` — Shared TypeScript library. Owns `StoryManager`, Monaco editor helpers, and the generated `mvs-types.ts` (built from molstar via rollup).
- `cli/` — Deno-based `mvs` CLI for authoring stories on disk (create/build/watch). Imports `@mol-view-stories/lib` directly from the workspace via a Deno import map.
- `api/` — Python 3.11 / Flask backend. Persists saved/published stories to MinIO (S3-compatible) keyed by OIDC user. OIDC auth is Life Science AAI.
- `webapp-patch/` — Snapshot of the dev-API patch published for downstream forks. Not used by this repo's own build; the live copies under `@mol-view-stories/webapp/src/app/api/dev/` are what runs.
- `docs/` — Quarto docs site.

The two TypeScript packages are declared in `pnpm-workspace.yaml`. The CLI and API are not in the pnpm workspace.

## Commands

All `pnpm` scripts run from the repo root unless noted. Each delegates to the workspace package(s).

```bash
# Frontend dev server (Next.js + Turbopack on :3000)
pnpm dev:web

# Build everything: regenerates lib/src/mvs-types.ts, then `next build`
pnpm build

# Formatting / type-checking
pnpm prettier         # write
pnpm prettier:check
pnpm tsc:check

# Regenerate MVS TypeScript types only (consumed by Monaco IntelliSense)
pnpm mvs-types

# Full local stack (frontend + Flask API + MinIO via Docker Compose)
./setup-local-dev.sh
```

### API (Python)

```bash
cd api
source .venv/bin/activate
python -m pytest tests/ -v                      # all tests, mocked — no MinIO needed
python -m pytest tests/test_storage.py::TestX   # single test
black --check --diff . && isort --check-only --diff .
flake8 . --exclude .venv,venv --select=E9,F63,F7,F82
black . && isort .                              # auto-fix
docker compose up -d --build                    # API on :5000, MinIO on :9000/:9001
```

### CLI (Deno)

```bash
cd cli
deno task build       # compiles to ./mvs binary
deno task test
./mvs create my-story
./mvs watch examples/exosome
```

## Frontend architecture

### Story data model (read this before editing state)

There are **two distinct Story shapes** in this codebase. They look similar; they are not interchangeable.

1. **Editor story** (`@mol-view-stories/lib` → `Story`): `{ metadata: {title, author_note}, javascript, scenes: SceneData[], assets: SceneAsset[] }`. `SceneData` has both a stable `id` (UUID, editor-internal) and a `key` (user-chosen, stable across applies). Assets are `Uint8Array` files.

2. **Dev-store story** (`webapp/src/lib/dev-store.ts` → `Story`): flatter shape used by `/api/dev/*` and the MCP loop. `{ title, author_note, story_js, scenes: [{key, name, ...}], settings, updatedAt }`. No `id`, no assets, no `metadata` wrapper.

Conversions live in `webapp/src/lib/dev-sync.ts` (`applyDevStoryToEditor`, `editorStoryToDev`). When merging dev → editor, scene IDs are preserved by matching on `key`; assets are preserved from the editor side.

### State

Editor state is Jotai atoms under `webapp/src/app/state/`. Entry point and re-exports are `app/appstate.ts`:

- `StoryAtom` — the single source of truth for the editor's story.
- `ActiveSceneIdAtom`, `ActiveSceneAtom` — currently selected scene.
- `CameraSnapshotAtom` (re-exported as `CameraPositionAtom`), `StoryAssetsAtom`, `OpenSessionAtom`.

Mutations go through helper functions in `state/actions.ts` (`addScene`, `downloadStory`, `exportState`, …), not via direct `setAtom`.

Server-state (saved stories, sessions, user quota) uses TanStack Query (`hooks/useStoriesQueries.ts`). Don't confuse it with Jotai — Jotai is local UI state, TanStack Query owns "what the backend says."

### MCP / Dev API (current branch: `mcp-integration`)

`NEXT_PUBLIC_DEV_API=1` exposes a per-process, in-memory HTTP API at `/api/dev/*` so an external MCP server can drive the editor. When this flag is on, `next.config.ts` disables `output: "export"` (route handlers are incompatible with static export).

- **Route files are named `route.dev.ts`, not `route.ts`.** `next.config.ts` only puts `"dev.ts"` in `pageExtensions` when the flag is on, so with the flag off Next never collects them and the default static-export build stays green. Naming one `route.ts` breaks `pnpm build` for everyone.
- Auth is opaque session IDs, not OIDC. Mint with `POST /api/dev/session`; clients send `Authorization: Bearer <id>` or `?token=<id>`. See `lib/dev-auth.ts` (server) and `lib/dev-session.ts` (browser).
- Store is process memory only (`lib/dev-store.ts`); dies on restart. Saved/published stories use the OIDC + Flask + MinIO path instead — these are deliberately separate flows.
- Both the session map and the story map are pinned to `globalThis`. `next dev` re-instantiates modules as it lazily compiles routes, and plain module-level state gets wiped the first time a client hits a cold route.
- `DevSyncListener` / `DevSyncMount` keep the live editor tab in sync with the dev-store between MCP edits. `dev-sync.ts` must carry over editor-only fields (`assets`, `ui_builder_state`, `ui_builder_constants`) from the current story, since the dev shape doesn't model them.

When adding a `/api/dev/*` route: name it `route.dev.ts`, gate it with `isDevEnabled()` (return 404 otherwise), and call `requireSession(req)` before touching the store.

Note `trailingSlash: true` — `/api/dev/story` 308-redirects to `/api/dev/story/`. `fetch` follows that transparently, but `curl` needs the slash (or `-L`) or a POST body silently goes nowhere.

### Routing / basePath

Production deploys live under `/mol-view-stories` on GitHub Pages, so `next.config.ts` sets `basePath` from `NEXT_PUBLIC_BASE_PATH` (defaults to `/mol-view-stories` in production, empty in dev). When writing fetches to internal API routes, use `devApiUrl(path)` from `lib/dev-sync.ts` so the same code works under both.

## Backend architecture (api/)

- `app.py` is the Flask entry point. Blueprints: `session_routes`, `story_routes`, `admin_routes`.
- Storage abstraction is `storage/` (MinIO client, metadata schema, quotas). All API payloads validated by Pydantic models with `extra="forbid"` — see `schemas.py`. Server-generated fields (`id`, `creator`, timestamps, `type`, `version`) **cannot** be overridden by request bodies.
- File-format enforcement: sessions must be `.mvstory` (base64 msgpack, optionally deflated); states must be `.mvsj` (JSON) or `.mvsx` (zip with `index.mvsj`).
- Tests in `api/tests/` are fully mocked — no MinIO instance needed to run them.

## Conventions

- **Frontend formatting**: prettier (single quotes, semicolons, width 120, jsx single quotes). Run `pnpm prettier:check` before committing.
- **API formatting**: black (line-length 88) + isort (black profile). Run both before committing.
- **CLI**: Deno's built-in fmt (`useTabs: false, lineWidth: 100, singleQuote: false` — note: double quotes here, unlike the webapp).
- Two Story shapes exist (see above). When touching code in `lib/dev-*.ts` or `/api/dev/*`, be explicit about which shape you're handling and use the adapters rather than open-coding the conversion.
- The `lib/mvs-types.ts` file is generated by `pnpm mvs-types`; don't hand-edit it.

## CI/CD

- PR to `main`: lint, build, tests, Docker image builds (no deploy).
- Push to `main`: auto-deploy to the dev environment at `https://mol-view-stories-ui-dev.dyn.cloud.e-infra.cz/mol-view-stories/`.
- Release tags `v*` / `release-*`: auto-deploy to production (UI via GitHub Pages, API via Kubernetes). Storage persists across deploys.
