# Logger (`@workspace/logger`)

Structured logging for Node processes and the browser, built on pino: leveled
loggers with request context, process-id tagging, and two output formats — raw
JSON for machines or a Go-style human-readable line for local dev.

## Role in the architecture

One logging contract for every app, worker, and service. `createLogger` (Node)
and the `./client` subpath (browser) share the same `Logger` type, so code that
logs can move between layers. `withLogContext` / `getLogContext` carry per-
request fields through async flows; `resolveLogLevel` / env helpers make the
level and format configurable per process without code changes.

## Commands

```bash
bun run build       # tsc -p tsconfig.build.json (emits dist/)
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
