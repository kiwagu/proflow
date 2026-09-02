# Workbench files (`@workspace/workbench-files`)

File-management UI for the workbench: the file explorer tree, file pane and
rows, file viewer, selection state, drag-and-drop upload, and the collapsible
section chrome around them.

## Role in the architecture

Host-agnostic React package: components receive their data and actions through
the `FileServicesProvider` / `FileSelectionProvider` contexts and props
(`DocumentActions`, blob accessors), so the same explorer works against any
host that can satisfy those contracts. `src/testing.ts` exports harness
helpers for consumers' tests.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
