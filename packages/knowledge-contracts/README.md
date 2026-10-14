# Knowledge contracts (`@workspace/knowledge-contracts`)

Zod schemas for the knowledge layer's shared data shapes: projection specs,
projection results, resource satellites (link, media, status, trash, workflow,
user state), the body bridge, and search queries/results.

## Role in the architecture

Contract-only package — schemas and their inferred types, no runtime services.
Producers (apps, workers, services) and consumers (`@workspace/knowledge-engine`,
UI packages) both parse against these schemas, so a shape change is made once,
here, and every layer type-checks against it. Subpath exports (`./projection`,
`./resource-workflow`, …) keep imports narrow.

## Commands

```bash
bun run test        # vitest
bun run build       # tsc -p tsconfig.build.json (emits dist/)
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
