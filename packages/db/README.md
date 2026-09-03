# Database types (`@workspace/db`)

Typed access to the Postgres schema for supabase-js consumers: the generated
`Database` type for the `public` schema, a hand-maintained typed view of the
`kb` application schema, and shared query contracts (e.g. the users filter).

## Role in the architecture

Types-and-contracts package, no runtime services. The `public`/`graphql_public`
types are GENERATED (`bun run gen:types` — requires the local Supabase stack's
env); `kb-schema.ts` is a thin hand-written mirror of the `kb` satellite tables
so the same RLS-scoped client can reach them via `db.schema('kb')` — the
migrations and RLS remain the single authority, this package only describes row
shapes. Regenerate after schema changes; hand-extend `kb-schema.ts` one
satellite at a time, in step with the migration.

## Commands

```bash
bun run gen:types   # regenerate database.types.ts from the local stack
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
