# Workbench (`workbench`)

The local-first authoring SPA: Vite + React, mounted on the gateway under
`/author/`. It composes the workbench packages (`@workspace/workbench-files`,
`@workspace/workbench-graph`, `@workspace/workbench-editor`) over the
in-browser database from `@workspace/persistence-pglite` and the OPFS blob
store from `@workspace/blob-store`.

## Role in the architecture

- `src/composition/` is the composition root — the only place that imports
  adapter packages. It opens the database and blob store, wires the
  optimistic document/file layer, and hands a port-only `AppServices` object
  down through context.
- `src/shell/` is the boot chrome: a static screen painted from `index.html`
  before any script, then the React shell while services open, then the app.
  A boot that outlives its timeout names the step it is stuck on.
- `src/app.tsx` mounts explorer, pane and command palette; the editor is a
  lazy chunk behind an error boundary so a fault inside it stays in the pane.

## Base path and gateway

Every asset and route is emitted under the base path (`WORKBENCH_BASE_PATH`,
default `/author`). In development the gateway (`apps/web`) rewrites
`/author/*` to this app's dev server on `WORKBENCH_DEV_PORT` (default 3002,
the gateway's `AUTHOR_DEV_PORT`) — HMR included. For production the gateway's
`build` stages this app's `dist/` under its `public/author/` and answers any
non-asset path under the mount with the SPA's index.

The database pool sizes are the store's own defaults and are not tuned here:
boot (initdb, migrations) draws on the standing pool, and a smaller one wedges
the open.

## Commands

```bash
bun run dev         # vite dev server (reach it through the gateway at /author/)
bun run build       # vite build → dist/
bun run preview     # serve dist/ on the dev port
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
