# Workbench graph (`@workspace/workbench-graph`)

Drive-level interactions for the workbench over local graph queries:
drag-and-drop moves, trash, starred, bulk actions, lenses, and the command
palette.

## Role in the architecture

Host-agnostic React package: `GraphServicesProvider` injects the query/mutation
surface, and the hooks (`useDriveData`, `useDriveDnd`, `useDriveMutations`,
`useDriveBulkActions`, `useLenses`, `useCommandPalette`) plus the
`CommandPalette` component build on it. `containment.ts` is the pure model of
the folder graph (ancestors, descendants, collision checks) and is what makes
DnD legality unit-testable without a database. `src/testing.ts` exports harness
helpers for consumers' tests.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
