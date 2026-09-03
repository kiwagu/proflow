# Knowledge workers (`@workspace/knowledge-workers-service`)

Background workers for the knowledge layer:

- **knowledge-activity** — durable JetStream consumer that appends body-edit
  activity rows to the database activity log; the DB roll-up trigger advances
  each resource's recency from there.
- **kb-media-reconcile** — reconciles media satellite rows against actually
  stored objects (reap pass for orphans).
- **workbench-blob-reap** — reaps unreferenced workbench blobs from storage.

## Trust model

The workers hold no user JWT and write via service role — a narrow carve-out
for derived audit/maintenance data whose originating action was already
authorized at produce time. All user-facing reads stay under RLS. Processing
is idempotent (at-least-once delivery + unique event keys), so replay and
out-of-order delivery are no-ops.

## Commands

```bash
bun run dev                        # all workers, watch mode (needs .env)
bun run start:knowledge-activity   # single worker variants; *:once for one pass
bun run test                       # vitest
bun run build                      # tsc
bun run lint                       # eslint (lint:strict for zero warnings)
bun run typecheck                  # tsc --noEmit
bun run format                     # prettier
```
