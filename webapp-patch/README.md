# MolViewStories dev API patch

This folder is a set of files to drop into a forked `mol-view-stories` repo
to enable a local dev-only HTTP API that an MCP server can talk to. With
this patched, Claude (via the MCP server) can:

- create / read / update / delete scenes
- update story-wide JS, title, author note
- introspect the Mol\* MVS builder (so it never guesses a method name again)
- export the story as `.mvsj` / `.mvsx` / story folder
- validate a scene's JS without you having to hit "Apply"

## Layout

```
webapp-patch/
  app/api/dev/
    story/route.ts        GET/POST/PATCH story-wide stuff
    scenes/route.ts       GET list of scenes
    scene/[key]/route.ts  GET/PUT/DELETE one scene
    export/route.ts       POST -> .mvsj / .mvsx
    validate/route.ts     POST -> run JS through the builder, return errors
    builder/route.ts      GET -> introspect MVS builder method names
  lib/dev-store.ts        Filesystem-backed StoryManager bridge
  components/DevSyncMount.tsx  Optional <script>-equivalent to keep the editor in sync
```

## Install

1. Fork `https://github.com/molstar/mol-view-stories` and clone your fork.

   ```
   git clone https://github.com/<you>/mol-view-stories.git
   cd mol-view-stories
   git checkout -b dev-api
   ```

2. The webapp lives at `@mol-view-stories/webapp`. Copy the contents of
   this `webapp-patch` folder into it, preserving subpaths:

   ```
   cp -r webapp-patch/app/* @mol-view-stories/webapp/app/
   cp -r webapp-patch/lib/*  @mol-view-stories/webapp/lib/
   cp -r webapp-patch/components/* @mol-view-stories/webapp/components/
   ```

3. Mount the dev sync component in the editor layout. Open
   `@mol-view-stories/webapp/app/builder/layout.tsx` (or wherever the
   editor root lives) and add at the top of the JSX:

   ```tsx
   import { DevSyncMount } from '@/components/DevSyncMount';
   // ...
   return (
     <>
       {process.env.NEXT_PUBLIC_DEV_API === '1' && <DevSyncMount />}
       {children}
     </>
   );
   ```

4. Create `.env.local` at the repo root:

   ```
   NEXT_PUBLIC_DEV_API=1
   MVS_DEV_STORE=./.mvs-dev/story.json
   ```

5. Run the webapp:

   ```
   pnpm install
   pnpm dev:web   # http://localhost:3000
   ```

6. Verify the API:

   ```
   curl http://localhost:3000/api/dev/story
   curl http://localhost:3000/api/dev/builder
   ```

## Safety

- All routes are gated by `NEXT_PUBLIC_DEV_API=1` and return 404 otherwise.
- The store file path is configurable via `MVS_DEV_STORE`.
- Bind the dev server to `127.0.0.1` only (Next.js default).
