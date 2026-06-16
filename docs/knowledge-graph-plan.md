# Knowledge graph — domain core plan

The product core. ProFlow's North Star: the minimal unit is a **knowledge resource**
(text, audio, video, link), resources connect into **directed graphs**, and business
applications (knowledge base, document management, courses/programs) are **projections over
one shared graph** — never separate data models.

## How to use

Action plan for building the knowledge-graph domain core, tracked like the cross-functional
checklists. `[x]` done · `[ ]` to do · `[~]` in progress. Items state accepted decisions as
plan facts; the deliberation behind them is kept out of this document on purpose.

## Decisions in force (the constitution)

- **Graph topology in Postgres.** `knowledge_resources` (nodes) and `knowledge_edges`
  (directed edges) live in Supabase Postgres, space-scoped, under RLS; traversal via recursive
  CTE over an adjacency list.
- **Bodies by data shape.** Rich-text bodies (`kind=text`) are authored in Payload; non-text
  resources (audio/video/link) are Postgres rows + Supabase Storage / external URL. A thin
  node↔body bridge links them via domain events.
- **Apps are projections.** A business app = a saved projection (filter + traversal + view
  type), not a new schema and not a new code path.
- **Generative core.** App types are data: vocabularies (`kind`, `relation_type`, `status`,
  `view`, permission verbs) live in reference tables, not enums. Adding a new app type needs no
  migration.
- **Authorization ≠ gating.** Access control (who may read) is RLS/RBAC, a hard boundary.
  Gating/pacing/ordering (e.g. a lesson locked until its prerequisite is done) lives in the
  projection layer + per-user state, never in RLS.
- **Per-user state is a thin anchor + satellites.** A small shared state table holds the
  cross-cutting minimum; each app extends it with its own typed satellite. Rich per-app
  statuses roll up to a small coarse status for cross-app views.

## 1. Graph schema (migrations)

- [x] `knowledge_resources` — node: `kind`, `title`, `status`, `visibility`, `body_ref`,
      `created_by`, `owner_user_id`; space-scoped + RLS (per `space-scoped-resource-tables`)
- [x] `knowledge_edges` — directed edge: `from_id`, `to_id`, `relation_type`, `position`,
      `metadata` (jsonb); space-scoped + RLS
- [x] Vocabulary reference tables (data, not enums): `resource_kinds`, `relation_types`,
      `view_types` (workflow vocabulary deferred — see §5)
- [x] Hot-path indexes: `(space_id, kind)`; edges `(from_id, relation_type, position)` and the
      reverse `(to_id, …)`
- [x] Permission verbs `space.knowledge.<verb>` registered; verbs extensible
- [x] Register entity-id prefixes for nodes (`knr`), edges (`kne`), `projections` (`prj`)
      (state/satellite prefixes deferred with per-user state)

## 2. Per-user state (anchor + satellites)

- [ ] `resource_user_state` — anchor: `user_id`, `resource_id`, `space_id`, `coarse_status`
      (not_started / in_progress / done / blocked), optional `progress`, `metadata` (jsonb); RLS
- [ ] Child-satellite pattern documented (FK to the anchor; a child's growth never alters core)
- [ ] Fine→coarse roll-up contract (how an app's fine statuses map to the coarse status)
- [ ] Start child state in `metadata` jsonb (schema-validated per kind); promote to a typed
      satellite table when it earns it

## 3. Node ↔ body bridge

- [x] Schema-first domain events: `body.linked` / `body.unlinked` (body ↔ node) — landed in
      `@workspace/knowledge-contracts` (`body-bridge.schema.ts`, discriminatedUnion on `event` +
      pinned `schema_version`), round-trip tested
- [x] `body_ref` (node → body) and back-reference (`space_id` + node id) on the body — the `bodies`
      Payload collection landed (projection-agnostic: `node_id`/`space_id`/`body` only, drafts on),
      two-way link asserted by the slice-03 acceptance test
- [x] Sync via outbox/JetStream (same pattern as identity sync); handle orphaned bodies — POC ships
      a synchronous fan-out plus a durable `outbox_jobs` row (the `body.linked` envelope) enqueued via
      a SECURITY DEFINER seam under the user's node-authority, and an idempotent `reconcileBodyBridge`
      saga (heal missing `body_ref`; remove orphan body). The async JetStream consumer is a seamless
      future swap (same envelope, same row)
- [x] Body access goes only to callers who passed the Postgres (RLS) gate (Payload access subordinate
      to RLS, keyed on the node id) — `bodies` read/update/delete reduce to a Postgres-RLS check by
      `node_id` under the caller's JWT; `create` is closed to the admin UI (fan-out only). Proven by
      the acceptance test (ungranted cannot read the body)
- [x] Only `kind=text` flows through Payload; audio/video/link → Postgres + Supabase Storage — the
      fan-out creates a `bodies` doc only for `kind=text`; no other kind touches Payload
- [x] One author action = fan-out save (node in Postgres under RLS, body in Payload), with partial-
      failure reconciliation; minimal authoring admin-view + two auth-contexts (Supabase session for
      graph endpoints, `payload-token` for `/admin/*`) — `/author/graph/*` endpoints (RLS) + a thin
      `@payloadcms/ui` admin-view (`/admin/knowledge/new-text`) over a UI-agnostic server module;
      `proxy.ts` splits the two auth contexts

## 4. Projection layer

- [x] `ProjectionSpec` schema = filter AST + traversal spec + view type
      (`@workspace/knowledge-contracts`)
- [x] Compiler: filter AST → RLS-safe SQL/CTE (parameterized; field/operator allow-list) —
      `@workspace/knowledge-engine` (`compileFilter`); values are positional params only, hard
      field/operator allow-list, zero value interpolation (unit-asserted)
- [x] `projections` table (`ProjectionSpec` as jsonb), space-scoped + RLS
- [ ] Query DX: enable `pg_graphql` / PostgREST (RLS-aware) — verify on self-hosted

## 5. Traversal & workflow

- [x] Recursive-CTE traversal helpers (prerequisites / lineage / associative) by `relation_type` —
      `@workspace/knowledge-engine` (`compileTraversal` + `resolveProjection`): depth-cap +
      path-array cycle-guard, outgoing/incoming, executed under the user's RLS session via the
      `security invoker` `resolve_projection_query` RPC (never service-role)
- [ ] Workflow as data: states + allowed transitions + guards; generic validator
- [ ] Enforce the authorization ≠ gating boundary (RLS for access; projection layer for pacing)
- [ ] `scopes` / `scope_memberships` as the generic audience/grouping primitive (course cohort /
      document folder ACL / knowledge-base section audience)

## 6. First projection — validate the invariant

- [x] Build one app (knowledge base) as a saved projection — no separate data model, no new
  code path (data layer + saved projection + projection EXECUTION landed via
  `@workspace/knowledge-engine`; the view render landed via the consumer render surface below.
  KB tagging is graph-native: a tag is a `kind='tag'` node and "has tag" is an incoming `tagged`
  traversal, not a column)
- [x] Consumer render: a view registry keyed by `ProjectionSpec.view` (a new view =
  a new component + one registry entry, zero model/resolver change), a `grid` renderer (knowledge
  base) and a `course` renderer (ordered prerequisite stepper, static lock indicator; real per-user
  gating deferred to §2), and a projection switcher that toggles the SAME graph between apps (the
  visible Invariant #1). Server-side resolution runs the engine under the user's RLS (never
  service-role); blocking resolve + Suspense. Render is an END-USER surface → shadcn (`@workspace/ui`).
  Pages live at `apps/author/src/app/graph/*`; proven by
  `tests/e2e/src/knowledge-projection-render.e2e.spec.ts` (grid ⇆ course over one graph; ungranted →
  empty by RLS; guest GET → sign-in redirect, guest POST → 401 JSON)
- [x] Confirm a second app type (a course) is pure configuration (vocabulary rows +
      ProjectionSpec) with zero core migration — proven by the slice 01 acceptance test
      (`tests/e2e/src/knowledge-graph-invariant.e2e.spec.ts`): both projections resolve over the
      identical resource/edge set, the course is one removable `projections` row, and the
      empty-schema-diff is asserted at the data level (demo data lives in the e2e harness, not a
      migration — production carries zero hardcoded demo rows)

## Open items

- [ ] Assign entity-id prefixes for per-user state and its satellites (deferred with §2;
      node/edge/projection prefixes `knr`/`kne`/`prj` are registered, and vocabularies use
      natural-key PKs, so no prefix is needed there)
- [x] Concrete filter/traversal schema — `FilterNode` + `TraversalSpec` landed in
      `@workspace/knowledge-contracts`; the remaining concrete work is the compiler (tracked in §4)
- [ ] Verify `pg_graphql` and (future) graph-extension feasibility on self-hosted Supabase
