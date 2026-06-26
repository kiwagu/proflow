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

- [x] `resource_user_state` — anchor: `user_id`, `resource_id`, `space_id`, `coarse_status`
      (not_started / in_progress / done / blocked), optional `progress`, `metadata` (jsonb); RLS.
      RLS is **own-rows only**: a user reads/writes ONLY their own rows (`user_id = auth.uid()`)
      within spaces they can access. Write is gated by a dedicated verb `space.knowledge.progress`
      (separate from `update`: a learner may advance their own progress without editing the graph);
      read uses `space.knowledge.read`. No cross-user reads in this slice (admin/reporting deferred).
      `coarse_status` is a deliberately small, closed, cross-app CHECK set (the stable roll-up target),
      not an app-extensibility vocabulary — per-app richness lives in fine statuses on a future child
      satellite. Anchor + entity-id prefix `rus`.
- [x] Authorization ≠ gating, landed: the course's previously-static lock is now a COMPUTED display
      state driven by the user's progress, NOT an access denial. RLS still lets the user SEE every
      course step (nodes stay in the projection result); the lock is decided by a pure, UI-agnostic
      gating function (ordered steps + the user's state map → per-step locked/unlocked) in
      `@workspace/knowledge-engine`. The resolver stays projection-PURE; the per-user overlay is a
      SEPARATE fetch merged at render time. A thin progress endpoint (under the user's
      RLS client, never service-role; `user_id` from the session) upserts the coarse status; a
      "mark complete" action advances a step to `done` and the next step unlocks
- [ ] Child-satellite pattern (FK to the anchor; a child's growth never alters core) — design
      recorded; no satellite built yet (deferred)
- [ ] Fine→coarse roll-up contract (how an app's fine statuses map to the coarse status) — applies
      only once a child workflow exists; deferred with the satellite (this slice sets `coarse_status`
      directly)
- [ ] Start child state in `metadata` jsonb (schema-validated per kind); promote to a typed
      satellite table when it earns it (the anchor `metadata jsonb` column is in place; not yet used)

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
- [x] Async durable bridge consumer (B2 hardening) — the sync fan-out is the fast path; this adds the
      background worker that processes any OPEN body-bridge `outbox_jobs` row so the bridge is
      eventually-consistent even when the sync path fails mid-way (the row is left open). REUSE the
      existing universal-outbox machinery: the body-bridge job is a `channel='operation'` /
      `operation_key='body-bridge'` row delivered over the same pgmq transport, claimed by the existing
      `rpc_outbox_claim_jobs` and completed/retried/dead-lettered by `rpc_outbox_complete_job` /
      `rpc_outbox_retry_job` — the same claim/ack/retry/DLQ loop the notifications outbox worker already
      runs (NOT a new delivery path). The consumer MUST validate the claimed payload against
      `bodyBridgeEnvelopeSchema` BEFORE acting (invalid → dead-letter, never silently processed), then
      runs the idempotent `reconcileBodyBridge(node_id)` so at-least-once delivery is safe (re-processing
      the same row is a no-op). The worker lives in the author app (it needs the Payload Local API for
      reconciliation) and is a trusted backend process, so service-role is appropriate here for the
      systemic reconcile (consistent with the existing orphan-repair path), kept separate from the
      user-RLS fan-out endpoints. Zero new migrations / contracts / engine / render. Acceptance (e2e,
      failure injected via the harness, not migrations): happy path → row closed, consumer no-op; injected
      sync failure → row stays open → consumer reconciles → `body_ref` eventually linked (or orphan
      removed); invalid envelope → dead-lettered, not processed; re-processing the same row is a no-op
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
- [x] Query DX: `pg_graphql` / PostgREST (RLS-aware) — verified on self-hosted. PostgREST is in
      active use (supabase-js under RLS); `pg_graphql` 1.5.11 is enabled, reflects the graph
      tables, and runs under the caller's role (RLS-aware). Available as a GraphQL surface; not
      wired into endpoints (the resolver + PostgREST cover current needs)

## 5. Traversal & workflow

> The business apps (knowledge base, course, document management) are EXAMPLES. The engine hosts a
> GENERAL conditional-access model, not those three special cases. Conditional node access is two
> orthogonal mechanisms: an **access layer** (hard / security — RLS/RBAC; if it fails the node is
> ABSENT from the result) and a **gating layer** (soft / business rule — a COMPUTED display flag; the
> node STAYS in the result). Classification criterion: if bypassing a rule is a security incident it
> belongs to the access layer; if it is just a broken process it belongs to the gating layer. The
> gating layer is a PLUGGABLE RULE REGISTRY — a `ProjectionSpec` declares which named rule(s) apply.
> An app = subgraph + chosen gating rule(s) + view + access scoping — all configuration.

- [x] Recursive-CTE traversal helpers (prerequisites / lineage / associative) by `relation_type` —
      `@workspace/knowledge-engine` (`compileTraversal` + `resolveProjection`): depth-cap +
      path-array cycle-guard, outgoing/incoming, executed under the user's RLS session via the
      `security invoker` `resolve_projection_query` RPC (never service-role)
- [x] Gating layer = a pluggable rule registry (mirror of the view registry). A gating rule is a
      pure, UI-agnostic predicate over `(user-state | resource-state | graph-context | scope)`.
      `sequence` (the ordered prerequisite rule) is one entry; `requires_state` (a node is available
      iff its resource status is in an allowed set) is added as a second entry — NOT an engine fork.
      The `ProjectionSpec` gains an optional `gating` declaration (which rule + params).
      Landed in `@workspace/knowledge-engine` (`gating-registry.ts`: `GATING_RULE_REGISTRY` +
      `resolveGatingRule`; `sequenceRule` is a thin adapter over the untouched `gateSequence`,
      `requiresStateRule` parses its own `{ allowed }` params) and `@workspace/knowledge-contracts`
      (`gatingDeclarationSchema`, optional `gating` on `projectionSpecSchema`; schema version unchanged
      as the field is additive/compatible); both unit-covered, resolver untouched (projection-PURE)
- [x] Workflow as data: states + allowed transitions + guards held as data (`resource_workflows`
      definition jsonb over `knowledge_resources.status`), validated by one generic transition
      validator; a thin transition endpoint under `space.knowledge.transition` (+ optional
      per-transition guard verb, e.g. `space.knowledge.approve`) rejects illegal transitions. This is
      the state source for the `requires_state` rule. Landed: the `resource_workflows` vocab table
      (natural-key PK, XState-compatible `definition` jsonb, select-only RLS), an additive nullable
      `knowledge_resources.workflow_key` FK, the status CHECK widened to
      `draft/active/archived/in_review/approved`, `default` + `document_review` seed definitions, the
      `space.knowledge.transition`/`space.knowledge.approve` verbs (admin+author→transition,
      admin→approve), the pure `validateTransition` engine function, the UI-agnostic
      `transitionResourceStatus` application module, and the thin endpoint (illegal → 422). The board
      view + server gating wiring + e2e landed (§8.B); the transition-action UI is deferred (the
      endpoint + e2e-through-API validate the write-path — board view stays display-only this slice)
- [x] Document management = an EXAMPLE projection, not a separate app: a `view_types` row (`board`) +
  a `projections` row filtering/segmenting by status with a `requires_state` gate (only `approved`
  docs are "available"). Adding it = vocabulary rows + a projection row + (optional) a workflow
  row, ZERO engine fork — the third vertical as pure configuration. Landed: the status-segmented
  board projection view + its `board` registry entry, a separate optional `nodeGates`
  view-prop, server wiring (`resolveProjectionGating` builds the resource-state map from the
  already-resolved items and applies the declared rule under the user's RLS client), and the
  a workflow-gating e2e (board renders all docs; non-approved gated as display)
- [x] Enforce the authorization ≠ gating boundary (RLS for access; gating layer for pacing/process) —
      the gating layer never denies access; a gated node stays in the result, RLS is the sole hard
      authority. Proven e2e: a non-approved doc stays in the board with `available=false` (display),
      while a reader without `space.knowledge.read` sees no documents at all (access = RLS)
- [x] Access-layer extensions (the COMPLEMENTARY mechanism): the hard/access layer (L1/RLS) is now a
      set of COMPOSABLE predicate dimensions over a node's visibility — symmetric to the gating-rule
      registry, but hard (RLS, auditable, non-bypassable). A failed dimension HIDES the node (absent
      from the result), unlike gating which keeps it visible. Two dimensions landed: (a) COHORT via the
      existing `scopes` / `scope_memberships` primitive (generic audience / folder ACL / section
      audience) — a thin `knowledge_resource_scopes` link plus a `scope_gate` predicate (an
      unrestricted node stays visible; a restricted node is visible iff the user is a member of ≥1 of
      its scopes); (b) manager→subordinate HIERARCHY — a space-scoped `reporting_lines` table plus a
      RECURSIVE RLS predicate granting a manager access to resources OWNED (`owner_user_id`) by their
      transitive subordinates (assignment-based access is a documented future option). The dimensions
      COMPOSE through one resource-level helper `auth_user_can_access_resource` (the SELECT policy
      passes the row's `id` / `space_id` / `owner_user_id` so it also holds under `... RETURNING`) —
      `(base AND scope) OR hierarchy` — so adding a dimension is a sub-predicate plus one helper line,
      not a rewrite of every policy; cohorts/lines are DATA (a new cohort = inserted rows, not a
      migration). The resolver is unchanged (the projection query runs `security invoker`, so the new
      RLS hides nodes natively across all projections/traversal). These are L1 ACCESS, NOT gating: they
      are never placed in the gating registry; a hidden node is ABSENT, never a visible `available=false`
      flag — keeping the authorization ≠ gating boundary intact. Demo data lives in the e2e harness, not
      a migration
- [x] Third access dimension — PER-PERSON sharing: a `knowledge_resource_user_grants` link (a calque of
      the cohort link, composite PK `(resource_id, user_id)`, same-space guard) plus one top-level OR in
      `auth_user_can_access_resource` — "share this node with one identified member". Owner-sovereign OR
      `space.knowledge.access` to grant/revoke (the audience-management verb); additive + fail-closed
      (grant widens, revoke narrows; live `security invoker` resolve ⇒ revoke hides, re-grant restores,
      zero reindex). Surfaced through ONE unified **Share dialog** (folding the broadcast floor + cohort
      grants + per-user grants into a single surface — the old cohort "Visibility" panel section is
      folded in, not a sibling), opened from a capability-gated `Share` entry in the node `⋯` menu
      (`canShare = owned || canAccess`, server-derived, laxer-not-stricter — RLS the sole fence). "Copy
      link" is pure navigation (grants nothing; RLS re-evaluates at open). Per ADR-0019
- [x] Co-member identity directory — a `space_member_directory` SECURITY-DEFINER RPC resolves
      `display_name` + `email` for co-members (the own-row `profiles` posture untouched), gated by the
      caller's own active membership (the fence — non-member → ∅, zero service-role), searchable +
      hard-limited (≤50). Powers the Share dialog people-picker; reusable for @mentions / assignment.
      Per ADR-0020
- [x] Directory v2 (data/route — picker scalability): keyset cursor (`p_after_key`,`p_after_user` over the
      stable `(sort_key, user_id)` order — drift-free, not offset) + a windowed `total_count` (the count of
      grantable matches, one round-trip) + `p_exclude uuid[]` (owner + already-granted removed BEFORE the
      limit AND the count, so a small page is full of real candidates and "+N more" is accurate). The fanout
      builds the exclusion set server-side + encodes the opaque cursor; the GET `members` slice becomes one
      `{ items, nextCursor, total }` page. The reusable picker UI + lenses/badges are later waves. Per ADR-0021
- [x] Directory v2 (reusable picker UI — Wave 1b): a generic, props-driven `AsyncSearchPicker<T>` in
      `@workspace/ui` `components/platform/` (the "типовая функция" — `fetchPage(query,cursor)→{items,
      nextCursor,total}` + `getKey`/`renderItem`/`onPick`/`labels`, NO i18n inside, render-prop rows). It
      owns the debounce + the cursor "load more" append + the "+N more" count footer, with a stale-response
      guard. The Share dialog people-picker is refit as a thin caller (fixed page of 5 + "+N more — keep
      typing to narrow" + "Show more"; granting drops the person out via server-side `p_exclude`). Per ADR-0021 §A4
- [x] "Shared by me" lens (Wave 2): the owner-direction sibling of "Shared with me". Data (Wave 2a) — a
      `listResourcesSharedByMe` fanout over `knowledge_resource_user_grants WHERE granted_by = me` joined to
      the resources I can still SEE (RLS the fence, fail-closed: a resource I revoked the only grant on, or
      can no longer see, never appears), SSR-seeded into `KbViewData.sharedByMe` (parity with Trash, no
      re-navigation). Render (Wave 2b) — a flat `'shared-by-me'` `DriveScope` + a sidebar nav item beside
      "Shared with me" (a send/outgoing `Send` icon vs the incoming `Users`); the lens is the resolved canvas
      ∩ the granted resourceId set, and each card shows a compact grantee summary (avatar cluster + "Shared
      with {name}" / "+{n}", per-avatar `Hint` name+email tooltip via `EntityAvatar`). v1 = per-user grants
      only (cohort-by-me deferred). Per ADR-0021 Part B
- [x] "Shared with me" mechanism distinction — DATA (Wave 3a): the `'shared'` lens (visible nodes I do
      NOT own) mixed three reasons a node is visible to me; this annotates each with the single WINNING
      mechanism — `personal` (a per-user grant to me) > `cohort` (a cohort I'm in) > `broadcast` (the
      space/org floor, with supervisory folded in for v1). A batched read-only fanout
      (`annotateShareMechanism({ spaceId, nodeIds })` → `Record<nodeId, ShareMechanism>`) — NOT per-node,
      NOT a resolver change: a constant cohort-membership read (via the `knowledge_user_scope_ids`
      security-definer RPC — the batched twin of the cohort predicate, needed because `scope_memberships`
      SELECT RLS gates on the legacy `space.content.read` a plain `member` lacks) plus two node-keyed
      IN-list reads (personal grants + cohort links), `broadcast` the in-memory residual. Seeded SSR as
      `KbViewData.shareMechanism` over the visible-not-owned set (parity with `sharedByMe`). Pure display
      enrichment over an already-RLS-admitted set — never a fence, Invariant #1 holds (no new table, no
      resolver change, no new access dimension). The per-card badges + facet chip-row are the Wave 3b
      render agent. Per ADR-0021 Part C
- [x] "Shared with me" mechanism distinction — RENDER (Wave 3b): the `'shared'` (incoming) lens now makes
      each node's WINNING mechanism LEGIBLE. A compact per-card mechanism badge (shadcn `Badge` + a lucide
      icon + a `Hint`): `personal` → "Shared with you" (UserCheck), `cohort` → "Via a group" (UsersRound),
      `broadcast` → "Whole space" (Radio) — threaded through the SAME card `footer` slot Wave 2b's grantee
      summary uses (no new card surface). Plus a facet chip row above the lens ("All" + one chip per
      mechanism PRESENT in the shared set — absent-mechanism chips hidden, the row appears only with ≥2
      mechanisms) that filters the rendered set client-side over the precomputed annotation; the facet is
      local lens state (reset on leave) with a "nothing shared this way" filtered-empty message. Badges +
      facet are scoped to the `'shared'` lens ONLY (not shared-by-me/home/trash). Pure DISPLAY over the
      already-fenced, already-resolved Wave 3a annotation — never recomputes access. en+es i18n in lockstep.
      Per ADR-0021 Part C
- [x] Tariff-gated ADVANCED (structural) view of the STRUCTURAL lenses — a commercial, VIEW-ONLY display
      mode that renders the SAME RLS-visible lens node-set as the KB containment TREE instead of a flat
      digest, gated by ONE generic platform ENTITLEMENT (`platform.entitlement.advanced_structural_view`,
      resolved global→org→space with org∧space AND-composition; zero service-role on the read path). Platform
      entitlement substrate landed first (Wave 1, re-keyed generic in Addendum A1); the author render threads
      it as `entitlements.advancedStructuralView` — a SIBLING of the RLS-verb `capabilities`, kept orthogonal
      (commercial plan ≠ permission) — into `KbViewData`. The display axis is lens-agnostic (`lensView`), gated
      by a render-side opt-in set `STRUCTURAL_LENS_SCOPES = {shared, shared-by-me, starred}`: a Flat/Advanced
      toolbar toggle appears ONLY on those lenses (NEVER Recent/Home), default Flat; the choice is an explicit
      `?view=` deep-link override AND a REMEMBERED preference (a server-read `lens-view` cookie, mirroring the
      grid/list `drive-layout` cookie, written only on the entitled Pro plan) — precedence `?view=` › cookie ›
      flat, then server-clamped to flat when not entitled (a forged URL or a stale cookie on a locked plan stays
      flat). A locked plan shows the toggle DISABLED + an upsell `Hint` (never hidden — the locked control IS the
      upsell). Advanced reuses the EXISTING `buildContainment` over the lens subset + the already-loaded LIVE
      `contains` forest — no new data model, no resolver change, no new load (Invariant #1); the advanced tree is
      folder-NAVIGABLE WITHIN the lens (drilling narrows to the folder's subtree in the lens set and STAYS on the
      lens scope, never breaking out to kb-browse), and a node whose parent is not in the lens set roots
      gracefully (no synthetic ancestors, ADR-0018 §14). RLS untouched: the same node-set renders in both modes.
      en+es i18n. Proven by `tests/e2e/src/knowledge-advanced-shared-view.e2e.spec.ts` (Shared: toggles flat↔tree
      over the same set, orphan-at-root, folder-drill stays + crumb returns, cookie-persist Pro-only, locked =
      disabled+hint + `?view=advanced`/stale-cookie still flat, org-off forces space-off; Starred: the same
      structural toggle renders the starred set as a tree + drill stays on Starred; negative: no toggle on
      Recent/Home). Per ADR-0022 + Addendum A (A1 platform re-key + A2 generic axis + A3 Starred).
      TRASH (Addendum A4) is DEFERRED pending a backend decision: its structural tree needs the dormant
      `contains` edges among trashed nodes, which the edge SELECT RLS hides (both-endpoints-trashed → not
      selectable under the user's RLS), so it cannot be built from a thin RLS select without a SECURITY DEFINER
      dormant-edge read or an edge-policy change — surfaced, not silently shipped flat-rooted.

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
      Pages live at `apps/author/src/app/graph/*`; proven by a projection-render e2e
      (grid ⇆ course over one graph; ungranted →
      empty by RLS; guest GET → sign-in redirect, guest POST → 401 JSON)
- [x] Confirm a second app type (a course) is pure configuration (vocabulary rows +
      ProjectionSpec) with zero core migration — proven by the slice 01 acceptance test
      (`tests/e2e/src/knowledge-graph-invariant.e2e.spec.ts`): both projections resolve over the
      identical resource/edge set, the course is one removable `projections` row, and the
      empty-schema-diff is asserted at the data level (demo data lives in the e2e harness, not a
      migration — production carries zero hardcoded demo rows)

## 7. Resource recency & activity (ADR-0016)

One append-only activity-log spine (`kb.resource_activity`); node `last_activity_at` and
per-user `last_opened_at` are roll-ups of it via one DB trigger. Hybrid ingest: Postgres-origin
in-txn triggers, the Mongo body path through a durable JetStream stream, and per-user opens under
the user's RLS.

- [x] Data layer (`kb.resource_activity` spine + roll-up trigger + Postgres-origin triggers +
      both roll-up columns + the `space.knowledge.open` verb) — append-only log, RLS read
      node-scoped + own-rows, INSERT split (open under `space.knowledge.open`, trigger definer,
      consumer service-role)
- [x] NATS activity worker + Bodies publish — `Bodies.afterChange` PUBLISHES a body-edit event on
      `knowledge.activity.v1.body` (best-effort, never throws on the save path; `Nats-Msg-Id =
      event_id` for dedupe); a durable consumer (`knowledge-activity.jetstream.worker`, stream
      `KNOWLEDGE_ACTIVITY`, consumer `author-activity-v1`) appends `kb.resource_activity`
      (`source=nats-body`) via service-role (authorize-at-produce, §0.3), idempotent on `event_id`.
      The roll-up trigger advances `last_activity_at` via `greatest()` — replay/out-of-order safe.
      Bootstrapped exactly like the identity & space-org workers (concurrently in `dev`; standalone
      `bun run knowledge-activity:jetstream`)
- [x] Opened route + contracts — `POST /author/graph/opened` (`{ spaceId, nodeId }`, zod-validated)
      under the user's RLS appends an `open` row (`source=open`, `kind=open`, `user_id` from the
      session) gated by `space.knowledge.open`; never service-role; best-effort. Contracts in
      `@workspace/knowledge-contracts`: `openedRecordSchema` + `parseOpenedRecord`,
      `last_opened_at` on `resourceUserStateSchema`, the `knowledgeActivityBodyEventSchema` NATS
      envelope shared by producer + consumer, and the stream/subject constants
- [ ] Read-path swap (Drive front) — loader selects `last_activity_at`, `byRecency` sorts by it,
      the deliberate-open call site POSTs `/author/graph/opened`, optional "Opened by me"
      (render-implementer, §5.5)

## 8. Drive Trash — reference-aware soft-delete lifecycle

A reversible holding state (live → trashed → purged) so a delete no longer severs
references (shortcuts, cross-folder containment, the Payload body) with no undo.
Lifecycle is a THIRD axis (`deleted_at`), orthogonal to access (`visibility`) and
workflow (`status`): the trashed/normal split is a query lens, not an access fence;
the access fence (`auth_user_can_access_resource`) is unchanged. Trash/restore are
owner-sovereign OR `space.knowledge.delete` (no new verb); purge is a real DELETE
guarded for in-use cross-owner references.

- [x] Data layer (Phase A) — `deleted_at` + `trashed_by` columns + the partial
      `(space_id, deleted_at)` index on `knowledge_resources`; the edge SELECT policy
      gains a per-endpoint `deleted_at IS NULL` conjunct (a trashed endpoint makes
      the edge dormant/hidden, preserved-not-pruned); the soft-cascade trigger
      `kb_cascade_trash_containment_orphans` (orphans trashed with the SAME stamp, a
      multi-parent child with a LIVING parent survives); the authority guard
      `assert_trash_change_authorized` (delete-tier, trash+restore) and the in-use
      purge guard `assert_purge_not_in_use`; the lifecycle audit trail on the EXISTING
      substrates (`kb.resource_activity` `kind=trashed/restored`, actor-stamped; a
      durable `space_admin_audit_log` `knowledge.resource.purged` row that outlives
      the node). No new table, no new verb, no new entity-id prefix, zero engine DDL
- [x] Fan-out + routes (Phase A) — `trashResource` / `restoreResource` / `purgeResource`
      application modules; the resource `DELETE` re-pointed to the soft trash path
      (text delete re-enabled — the N→1 severing reason is gone); a DISTINCT
      `/author/graph/trash` route (PATCH restore, DELETE purge with best-effort inline
      `deleteBody` after commit); zod input contracts in `@workspace/knowledge-contracts`
- [x] Lifecycle lens split (Phase A) — the resolver/loader excludes trashed in normal
      browse (`deleted_at IS NULL`) via a thin post-resolve filter + the dormant-edge
      RLS policy; the Trash lens selector is `deleted_at IS NOT NULL`. The frozen
      `ProjectionSpec`/engine contract (`schema_version=1`) is untouched
- [x] e2e (Phase A) — trash hides/round-trips references; soft-cascade orphan +
      multi-parent survival; cross-owner trash/restore gated; purge destroys + body
      reap (failure non-fatal); graceful-absence (parent renders); immutable kra
      trail (actor); durable purge audit survives the node + its kra rows
- [x] Trash lens UI (Phase B, render-implementer) — `DriveScope += 'trash'`, the
      `navTrash` sidebar entry (drop `comingSoon`, `scope: 'trash'`), the Trash lens
      resolved server-side under RLS (`deleted_at IS NOT NULL`) and threaded alongside
      the live canvas as a flat lens, Restore/Purge per-row affordances (purge confirms;
      the in-use guard rejection surfaces the cooperative "in use" message — never
      thrown), the tree-builder graceful-absence audit (no non-null assertions on
      cross-query lookups; dangling edges dropped at `buildForest`, every lookup guarded;
      int test asserts a parent renders when a contained child is absent), i18n keys
      (`graph.trash.restore/purge/purgeConfirm/inUse/empty`, en+es)

## Open items

- [x] Assign entity-id prefixes for per-user state and its satellites — the anchor prefix `rus`
      (`resource_user_state`) is registered; satellite prefixes are deferred with the satellites.
      Node/edge/projection prefixes `knr`/`kne`/`prj` are registered, and vocabularies use
      natural-key PKs, so no prefix is needed there
- [x] Concrete filter/traversal schema — `FilterNode` + `TraversalSpec` landed in
      `@workspace/knowledge-contracts`; the remaining concrete work is the compiler (tracked in §4)
- [ ] Verify `pg_graphql` and (future) graph-extension feasibility on self-hosted Supabase
