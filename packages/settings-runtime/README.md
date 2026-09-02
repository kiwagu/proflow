# Settings runtime (`@workspace/settings-runtime`)

Zod schemas and types for runtime settings: scoped configuration values
(global / organization / space / user) with typed value kinds (string,
boolean, number, json).

## Role in the architecture

Contract-only package — it defines what a runtime setting _is_ (its scope,
value type, and validation), not where it is stored or how it is fetched.
Producers (admin surfaces, migrations) and consumers (apps reading their
effective settings) both parse against these schemas so scope and type rules
are enforced identically everywhere.

## Commands

```bash
bun run build       # tsc -p tsconfig.build.json (emits dist/)
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
