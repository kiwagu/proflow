# Document indexer (`@workspace/document-indexer-service`)

Server-side search engine for documents: a derive worker that keeps the search
index converged with the canonical document stream, plus an optional HTTP
search endpoint that reads that index.

## Role in the architecture

The two halves live in one process on purpose — they share the pinned embedding
model, and a query embedded by a different model than the chunks would rank
meaninglessly. The worker runs under the service role (background derive); the
search endpoint runs every query under the caller's token, so reads stay under
RLS. Without the anon key configured, the process degrades to a pure background
worker.

## Commands

```bash
bun run dev         # tsx watch (loads .env if present)
bun run start       # run the service
bun run once        # single index pass, then exit
bun run test        # vitest
bun run build       # tsc
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
