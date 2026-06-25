# `@workspace/seed` — reference content, one dictionary

The seed is the single home for **reference content** that creates the platform's
worked examples. It exists to serve four jobs at once:

1. **e2e consistency** — the Drive e2e specs build their trees from the SAME
   catalog the demo uses, so the database seed and the tests share one
   create-vocabulary (and the `ref` names anchor human ↔ LLM feedback).
2. **No more hand-built trees** — one command materializes a whole resource tree
   together with its access model.
3. **Demo population** — the demo site is filled by running this seed.
4. **Self-documentation** — each scenario's `summary` and real Lexical bodies make
   the seed the platform's learning material. Content is English-only.

Everything is created the way the product creates it: by driving the live
`/author/graph/*` endpoints as an authenticated user under RLS (migrations never
seed domain content — that poisons the author identity-sync worker).

## Run it

```bash
bun run seed                        # all presets → the stable demo tenant
bun run seed --preset=drive         # just the Drive scenarios
bun run seed --fresh --preset=drive # ephemeral tenant, torn down after (CI/smoke)
bun run seed --reset                # zero the demo space content (no re-seed)
bun run seed --manifest=seed.json   # also dump the seeded ref→id map to JSON
bun run seed:list                   # presets + scenario summaries (no DB writes)
```

The catalog is validated offline before any endpoint call (and in CI via
`bun run test:vitest` → `src/catalog/validate.ts`): duplicate/empty `ref`s,
cross-references that point at nothing (owner / scope / tag / actor / node), bad
presets, malformed Lexical bodies. The `--manifest` JSON is the machine-readable
dictionary — every demo node named by its stable `ref`, keyed by scenario — for
LLM ↔ human feedback and demo verification.

Needs the stack running (the author app + Postgres + Payload/Mongo), exactly like
the `@full` e2e suite. Supabase keys are read from `seed/.env` then `tests/e2e/.env`
(see `.env.example`); the shell wins over both.

### Tenant modes

- `--demo` (default) — a **stable** org/space (`proflow-demo` / `demo-space`) and a
  `demo-viewer@proflow.local` viewer (password `ProflowDemo!1`). Idempotent: the
  shell is reused and the space content is rebuilt from scratch each run, so the end
  state is deterministic.
- `--fresh` — a brand-new random tenant, torn down at the end. For CI smoke.
- `--reset` — zero the demo space's content (no re-seed), then exit.

The demo content is authored and explored under the `demo-*` users: it is owned by
**`demo-admin@proflow.local`** (the `admin` role), with **`demo-viewer@proflow.local`**
as a `space_admin` — both password `ProflowDemo!1`. Content is private-by-default
(ADR-0017), so log in as `demo-admin` to see and edit it.

### Presets

`all` (default) materializes everything. Named presets — `drive`, `access`,
`per-user-share`, `knowledge-base`, `board`, `shared`, `hierarchy`, `trash` — group the
scenarios for one capability so the seed stays runnable as the catalog grows. A scenario
opts into a preset via its `presets` field. `access` is cohort/floor sharing;
`per-user-share` is per-person sharing (a private doc granted to one named member,
ADR-0019 — the grantee sees it, a third un-granted member stays blind). Its space is
multi-member with named co-members, so the SAME scenario also feeds the Share dialog's
co-member identity directory (ADR-0020): the people-picker + "who has access" rows
resolve a co-member's `display_name` + `email` (never a bare short-id), search (`?q=`)
narrows it, and a non-member of the space gets an empty directory (the membership fence).

## The dictionary

Catalog scenarios (`src/catalog/*.ts`) are **declarative data** addressed by stable
`ref` strings. `materializeScenario` walks a scenario through the endpoints and
returns `ref → id`, so the demo and the e2e specs name the very same nodes.

```
src/
  engine/      tenant bootstrap (ephemeral + demo), actors, SSR cookies,
               the /author/graph/* HTTP wrappers (the create-vocabulary)
  catalog/     the dictionary: drive, access, knowledge-base, board, shared,
               hierarchy, trash + the projection spec builders + the materializer
  presets.ts   preset → scenario selection
  cli.ts       the `bun run seed` entrypoint
```

## How e2e consumes it

`@workspace/e2e` depends on `@workspace/seed`. The e2e helper re-exports the engine
primitives (so existing specs are unchanged) and the Drive specs build their trees
with the shared HTTP client + catalog fixtures (`drive-cascade`, `drive-copy-chain`).
The per-person-sharing access-matrix spec
(`knowledge-per-user-share.e2e.spec.ts`) likewise draws ENTIRELY from the shared
`per-user-share` scenario via `seedPerUserShareFixture` — the seeded grant, the
revoke→re-grant arc, and the authority/cross-space negatives all run through the one
`grantUser` / `revokeUser` vocabulary, never inline create/delete helpers. The same
spec also drives the co-member directory (ADR-0020) through the shared `visibility`
wrapper (`GET /author/graph/visibility?q=`): the picker/grant rows resolve the seeded
co-member `display_name`s, search narrows, and a non-member sees an empty directory.

## Extending the catalog

When a feature lands, add or grow a scenario (declarative data + a real body + a
`summary`), wire it into a preset, and have a consuming e2e draw from it. The
`seed-curator` agent owns keeping the seed, the demo, and the e2e dictionary in
lockstep — never by seeding through migrations.
