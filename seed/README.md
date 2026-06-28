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
`per-user-share`, `knowledge-base`, `search`, `board`, `shared`, `hierarchy`, `trash` —
group the scenarios for one capability so the seed stays runnable as the catalog grows. A
scenario opts into a preset via its `presets` field. `access` is cohort/floor sharing;
`shared` is the "Shared with me" lens — cross-shared docs that fill it both ways PLUS the
mechanism-distinction fixture (ADR-0021 Part C): one non-owner `viewer` sees four nodes
owned by another member, one per access MECHANISM — a per-user grant (→ `personal`), a
cohort grant to a cohort the viewer belongs to (→ `cohort`), a space-floor publish
(→ `broadcast`), and a both-granted node that must win as `personal` (precedence
`personal > cohort > broadcast`). The Wave 3b render/badge e2e draws it via
`seedShareMechanismFixture`. The `shared` preset ALSO carries the `advanced-shared`
fixture (ADR-0022): the worked example for the tariff-gated ADVANCED (structural) display
of the Shared lenses, which renders the SAME RLS-visible shared node-set as the KB
containment TREE (vs the flat digest), gated by the COMMERCIAL `advanced_shared_view`
entitlement. The minimal tree — a shared FOLDER ⊃ a shared DOC (so the doc NESTS under the
folder in the tree) plus a published doc whose containing folder stays PRIVATE (so the doc
appears at the ROOT — graceful-absence, no synthetic ancestor). It is view-only: the advanced
tree just reuses `buildContainment` over the shared subset (no resolver change, Invariant #1),
so the SAME three nodes the flat digest lists are re-arranged structurally. The ADR-0022
e2e draws the tree via `seedAdvancedSharedFixture`; the COMMERCIAL entitlement rows are
control-plane config (a service-role `runtime_settings` upsert via `setAdvancedSharedEntitlement`),
out of scope for a content scenario.
The `shared` preset ALSO carries the `containment-inheritance` fixture (ADR-0023): the
worked example for owner-scoped, LIVE containment access inheritance — sharing a folder
makes its OWNER-SCOPED descendants readable to the grantee (a new child auto-appears, a
revoke removes the subtree), additive-OR (a self-granted child survives the folder revoke),
across the per-user / cohort / space-floor conferring dimensions — but NEVER cross-owner
(a third party's node merely FILED into the folder, even an admin's folder-share, stays
private; only that owner's OWN explicit grant exposes it). The MINIMAL multi-owner tree —
a shared folder ⊃ A's own child / deep own subfolder+grandchild / a self-granted child,
an admin's curator-folder, a space-floor folder, and a cohort-folder — with three
ownerB-owned nested nodes (the owner-scope negatives) FILED via the `contains` `by`
cross-owner filer. It is a pure RLS-predicate widening (no new endpoint, no resolver
change): the ADR-0023 access-matrix e2e draws the tree via `seedContainmentInheritanceFixture`
and drives the live arcs (new-child / revoke / re-grant) through the same create-vocabulary.
`per-user-share` is per-person sharing (a private doc granted to one named member,
ADR-0019 — the grantee sees it, a third un-granted member stays blind). That ONE grant is
read from BOTH ends of the grant graph (ADR-0021 Part B): the grantee sees the doc in the
"Shared with me" lens (DriveScope `shared`), while the OWNER sees the same grant in the
"Shared by me" lens (DriveScope `shared-by-me`) — a read-only projection over
`knowledge_resource_user_grants WHERE granted_by = me`, surfaced as a `SharedByMeEntry`
(`{ resourceId, grantees }`). The catalog adds no second grant for the opposite direction;
both lenses read the one `per-user-share/granted` row, and the un-granted sibling appears in
neither. (Wave 2 a landed only the `shared-by-me` DATA slice; the lens render + its e2e
assertion are the Wave 2 b close-out — the scenario already carries the data they will draw
from.) Its space is multi-member with named co-members, so the SAME scenario also feeds the
Share dialog's co-member identity directory (ADR-0020): the people-picker + "who has access"
rows resolve a co-member's `display_name` + `email` (never a bare short-id), search (`?q=`)
narrows it, and a non-member of the space gets an empty directory (the membership fence).
The `per-user-share` preset ALSO carries the `directory-picker` scenario — a ten-member
grantable cohort sharing one space with a private share target — that exercises the
paginated directory-v2 picker (ADR-0021 Part A): a page of 5 + "+N more", a keyset
"Show more" next page with no overlap, and `p_exclude` dropping the owner + the
already-granted member from BOTH the page and the `total_count`.
`search` is the lexical-search corpus (ADR-0024 / slice-12): the `knowledge-base` scenario
ALSO opts into it, layering a multi-locale match set onto the KB articles — a Cyrillic node
(`Договор аренды`, case-insensitive prefix), an accented node (`Égérie`, `unaccent` fold),
the English `Getting Started` (case-insensitive prefix), and the Phase-2 typo target
(`Привет команде`, seeded now, asserted later) — PLUS the RLS-absence proof (ADR-0024 §6):
a PRIVATE node owned by a SECOND space member (`searcherB`) that must stay ABSENT from a
non-grantee's search, and a child under a folder shared to `searcherB` that is PRESENT for
them via the ADR-0023 inherited-grant disjunct composing through search. RLS is the SOLE
fence — there is no app-level visibility filter — so the search SELECT runs as the user
through the reused projection-resolve transport (ADR-0009). The other-space negative
(a node in a DIFFERENT space) is built in the e2e fixture's second tenant, since a catalog
scenario is single-space.

## The dictionary

Catalog scenarios (`src/catalog/*.ts`) are **declarative data** addressed by stable
`ref` strings. `materializeScenario` walks a scenario through the endpoints and
returns `ref → id`, so the demo and the e2e specs name the very same nodes.

```
src/
  engine/      tenant bootstrap (ephemeral + demo), actors, SSR cookies,
               the /author/graph/* HTTP wrappers (the create-vocabulary)
  catalog/     the dictionary: drive, access, knowledge-base, board, shared,
               share-mechanism, advanced-shared, hierarchy, per-user-share,
               directory-picker, containment-inheritance, trash + the projection
               spec builders + the materializer
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
A second describe-block in the same spec draws the `directory-picker` scenario's
ten-member space via `seedDirectoryPickerFixture` and exercises the PAGINATED picker
(ADR-0021): the `visibility` wrapper now returns `members` as a keyset PAGE
(`{ items, nextCursor, total }`) and accepts `{ cursor, limit }`, so the spec asserts a
page of 5 + an accurate "+N more" `total`, a "Show more" (`cursor`) next page with no
overlap, search narrowing the `total` below a page, and `p_exclude` dropping the owner +
already-granted (and a just-granted member) from BOTH the page and the count.

The containment-inheritance access-matrix spec
(`knowledge-containment-inheritance.e2e.spec.ts`, ADR-0023) likewise draws its whole
multi-owner tree from the shared `containment-inheritance` scenario via
`seedContainmentInheritanceFixture` — the folder grant (`grantUser`), the cross-owner
filing (`contain`, with the catalog's `contains.by` filer), the floor (`setFloor`) and
the cohort link (`linkScope`) are all created the product's way. The LIVE arcs (a NEW
child auto-appearing, a folder REVOKE removing the inherited subtree, a RE-GRANT, and a
`contains` cycle that must not hang or over-grant) run through the SAME
`seedClientFor(actor)` create-vocabulary, never inline create/delete helpers — so the
demo DB and the test exercise one owner-scoped inheritance predicate identically.

The lexical-search matrix spec (`knowledge-search.e2e.spec.ts`, ADR-0024 / slice-12)
draws its corpus from the shared `knowledge-base` scenario via `seedSearchCorpusFixture`,
and runs the search itself through the SAME create-vocabulary — `seedClientFor(actor).search`
POSTs `/author/graph/search`, the REAL route, RLS-fenced as the acting user — so a hit's
presence/absence is the live runtime truth. It asserts the Phase-1 match classes (Cyrillic /
accented / case-insensitive prefix) and the security proof: another user's PRIVATE node is
ABSENT for a non-grantee, an ancestor-shared child is PRESENT for the grantee (inherited
grant), and a node in a SECOND tenant (built by the fixture, since the catalog is
single-space) stays out of an in-space search — every absence proven by RLS, not an app filter.

## Extending the catalog

When a feature lands, add or grow a scenario (declarative data + a real body + a
`summary`), wire it into a preset, and have a consuming e2e draw from it. The
`seed-curator` agent owns keeping the seed, the demo, and the e2e dictionary in
lockstep — never by seeding through migrations.
