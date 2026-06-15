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

- [ ] `knowledge_resources` — node: `kind`, `title`, `status`, `visibility`, `body_ref`,
  `created_by`, `owner_user_id`; space-scoped + RLS (per `space-scoped-resource-tables`)
- [ ] `knowledge_edges` — directed edge: `from_id`, `to_id`, `relation_type`, `position`,
  `metadata` (jsonb); space-scoped + RLS
- [ ] Vocabulary reference tables (data, not enums): `resource_kinds`, `relation_types`,
  `view_types` (+ workflow vocabulary, see §5)
- [ ] Hot-path indexes: `(space_id, kind)`; edges `(from_id, relation_type, position)` and the
  reverse `(to_id, …)`
- [ ] Permission verbs `space.knowledge.<verb>` registered; verbs extensible
- [ ] Register entity-id prefixes for nodes, edges, state, dictionaries

## 2. Per-user state (anchor + satellites)

- [ ] `resource_user_state` — anchor: `user_id`, `resource_id`, `space_id`, `coarse_status`
  (not_started / in_progress / done / blocked), optional `progress`, `metadata` (jsonb); RLS
- [ ] Child-satellite pattern documented (FK to the anchor; a child's growth never alters core)
- [ ] Fine→coarse roll-up contract (how an app's fine statuses map to the coarse status)
- [ ] Start child state in `metadata` jsonb (schema-validated per kind); promote to a typed
  satellite table when it earns it

## 3. Node ↔ body bridge

- [ ] Schema-first domain events: create/update/delete of body ↔ node
- [ ] `body_ref` (node → body) and back-reference (`space_id` + node id) on the body
- [ ] Sync via outbox/JetStream (same pattern as identity sync); handle orphaned bodies
- [ ] Body access goes only to callers who passed the Postgres (RLS) gate
- [ ] Only `kind=text` flows through Payload; audio/video/link → Postgres + Supabase Storage

## 4. Projection layer

- [ ] `ProjectionSpec` schema = filter AST + traversal spec + view type
- [ ] Compiler: filter AST → RLS-safe SQL/CTE (parameterized; field/operator allow-list)
- [ ] `projections` table (`ProjectionSpec` as jsonb), space-scoped + RLS
- [ ] Query DX: enable `pg_graphql` / PostgREST (RLS-aware) — verify on self-hosted

## 5. Traversal & workflow

- [ ] Recursive-CTE traversal helpers (prerequisites / lineage / associative) by `relation_type`
- [ ] Workflow as data: states + allowed transitions + guards; generic validator
- [ ] Enforce the authorization ≠ gating boundary (RLS for access; projection layer for pacing)
- [ ] `scopes` / `scope_memberships` as the generic audience/grouping primitive (course cohort /
  document folder ACL / knowledge-base section audience)

## 6. First projection — validate the invariant

- [ ] Build one app (e.g. knowledge base) end-to-end as a saved projection — no separate data
  model, no new code path
- [ ] Confirm a second app type (document management or a course) is pure configuration
  (vocabulary rows + ProjectionSpec + optional satellite) with zero core migration

## Open items

- [ ] Assign entity-id prefixes for state, satellites, dictionaries, `projections`
- [ ] Concrete filter/traversal schema — pin down with the first projection
- [ ] Verify `pg_graphql` and (future) graph-extension feasibility on self-hosted Supabase
