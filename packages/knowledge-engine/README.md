# Knowledge engine (`@workspace/knowledge-engine`)

Compiles the declarative knowledge contracts into executable SQL and resolves
them against a transport: filter/traversal/projection/search compilers, the
gating registry, sequence gating, and the workflow validator.

## Role in the architecture

The policy layer between `@workspace/knowledge-contracts` (what a query _is_)
and the database (where it runs). A projection spec parsed by the contracts
package is compiled here (`compileFilter`, `compileTraversal`,
`compileProjectionQuery`) into SQL fragments and resolved through an injected
`ResolveQueryTransport`, so the same engine serves both a local database and a
server RPC. Search follows the same shape (`compileSearchQuery`,
`encodeSearchCursor`). Gating rules and workflow validation live here so every
caller enforces them identically.

## Commands

```bash
bun run test        # vitest
bun run build       # tsc -p tsconfig.build.json (emits dist/)
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
