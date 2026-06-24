/*
 * kb.resource_activity — central activity-log spine + node/per-user recency roll-ups
 * (see docs/knowledge-graph-plan.md). Activates the `kb.resource_activity` satellite
 * (prefix `kra`) as the single append-only log every activity-producing path converges
 * on, and derives the two denormalized read columns from it via one roll-up trigger.
 *
 * what this migration builds (Postgres/data layer only — the NATS worker, the Bodies
 * publish hook, the open-route and the zod contracts land in their own work):
 *   (a) kb.resource_activity — append-only node satellite (prefix `kra`), keyed by
 *       knowledge_resources.id; indexes for node roll-up, per-user recent, and a
 *       partial-unique on event_id for NATS at-least-once dedupe; append-only RLS.
 *   (b) two denormalized roll-up columns + their indexes:
 *         public.knowledge_resources.last_activity_at (node-grain recency)
 *         public.resource_user_state.last_opened_at   (per-user "opened by me")
 *   (c) kb.rollup_resource_activity — one AFTER INSERT trigger on the log that bumps
 *       both columns with greatest() (monotonic, re-delivery / out-of-order safe).
 *   (d) kb.append_activity_from_origin — the Postgres-origin trigger that inserts a
 *       `kra` row in the SAME transaction as a satellite / edge / node write, so
 *       Recent is honest below the app for EVERY writer (route / edge-fn / direct SQL),
 *       the cascade-delete precedent. Attached here to kb.resource_description,
 *       public.knowledge_edges (BOTH endpoints), and public.knowledge_resources
 *       (user-facing columns only — the loop-guard vs the roll-up's last_activity_at
 *       write). Every future kb.* satellite attaches this same function (directive in
 *       the machinery comment block below).
 *   (e) the new verb space.knowledge.open — permission row + base `member`-role
 *       mapping (all space members hold it), gating the user-initiated "open" append.
 *
 * trust / RLS boundary (normative):
 *   - INGEST of the log is split by path: the Postgres-origin trigger appends in-txn
 *     under SECURITY DEFINER (its originating write was already authorized by that
 *     table's own RLS); the open path appends under the user's RLS gated by
 *     space.knowledge.open + own-rows; the NATS consumer appends via service-role as
 *     trusted background ingest of derived audit metadata.
 *   - QUERY of the log (and of both denormalized columns) is ALWAYS under the user's
 *     RLS: node-subordinate read for node-wide rows, plus own-rows for user_id-bearing
 *     rows. Append-only — no user UPDATE/DELETE; deletion only via the node cascade.
 *
 * Invariant #1 intact: the log is a node satellite (no parallel graph, no new
 * "documents" model); the two roll-up columns are attributes on existing anchors.
 */

-- ===========================================================================
-- (e) verb space.knowledge.open — permission row ONLY.
--     The role mapping is the READ-TIER derive (open follows whoever holds
--     space.knowledge.read), seeded in 20260623193000 — NOT a name-by-name
--     role grant. ADR-0017 §3 supersedes ADR-0011 §6's member-grant: the old
--     name-by-name member→open map left `member` holding `open` without
--     `read`, an incoherence the derive removes. Gates the user-initiated open
--     append (5.1a INSERT policy).
-- ===========================================================================

insert into public.permissions (key, description) values
  ('space.knowledge.open', 'Record one''s own deliberate "open" of a knowledge resource in one space.')
on conflict (key) do nothing;

-- ===========================================================================
-- (b) denormalized roll-up columns (the SQL/RLS-queryable read targets)
-- ===========================================================================

-- node-grain recency: any activity on the node advances it (roll-up of the log).
-- not null with a creation default so the read path never sorts on NULLs; the
-- backfill below keeps it correct forward (a no-op on a fresh reset-mode DB).
alter table public.knowledge_resources
  add column last_activity_at timestamptz not null default timezone('utc', now());

comment on column public.knowledge_resources.last_activity_at is
  'Cross-store activity roll-up (node grain): greatest occurred_at over kb.resource_activity rows for this node. Distinct from updated_at (node row last written). Maintained by kb.rollup_resource_activity.';

-- per-user "opened by me": nullable (null = never opened by this user).
alter table public.resource_user_state
  add column last_opened_at timestamptz;

comment on column public.resource_user_state.last_opened_at is
  'Per-user "recently opened by me" roll-up: greatest occurred_at over kind=open kb.resource_activity rows for this (user, resource). Null = never opened. Maintained by kb.rollup_resource_activity.';

-- backfill node recency from the best signal we have at landing time. greatest()
-- so a node never regresses below its own write/creation time. forward-correct;
-- a no-op when the table is empty (reset mode).
update public.knowledge_resources
  set last_activity_at = greatest(updated_at, created_at);

-- hot-path sort/filter index for space-wide "Recent".
create index knowledge_resources_space_activity_idx
  on public.knowledge_resources (space_id, last_activity_at desc);

-- hot-path sort index for "opened by me" (partial: only rows that were opened).
create index resource_user_state_user_space_opened_idx
  on public.resource_user_state (user_id, space_id, last_opened_at desc)
  where last_opened_at is not null;

-- ===========================================================================
-- (a) the spine — kb.resource_activity (prefix `kra`). Append-only node satellite.
-- ===========================================================================

create table kb.resource_activity (
  id text primary key default public.entity_id_generate('kra'),
  space_id text not null references public.spaces (id) on delete cascade,
  resource_id text not null references public.knowledge_resources (id) on delete cascade,
  -- null = system / space-wide fact (pg-trigger, nats-body); set = a per-user act (open).
  -- set null on user deletion: the append-only audit fact survives as a space-wide row.
  user_id uuid references auth.users (id) on delete set null,
  -- free-text descriptor (vocab-as-data spirit, ADR-0004); no app names leak into the
  -- schema. e.g. 'open' | 'body_edit' | 'description_edit' | 'edge_change' | 'node_write'.
  kind text not null,
  -- the ingest-path discriminator (closed set: the three §0.2 paths).
  source text not null check (source in ('pg-trigger', 'nats-body', 'open')),
  -- NATS Nats-Msg-Id for the consumer's idempotent append; null for non-NATS paths.
  event_id text,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

comment on table kb.resource_activity is
  'Append-only activity-log spine (KB node satellite, 1:N): a fact that resource R had activity of kind K from source S at time T, by user U or system. The single source of truth every producer converges on; node/per-user recency are roll-ups of it. Never a parallel graph.';
comment on column kb.resource_activity.user_id is
  'Null = system/space-wide fact (pg-trigger/nats-body); set = per-user act (open). On user deletion the row is retained space-wide (set null).';
comment on column kb.resource_activity.event_id is
  'NATS Nats-Msg-Id for the consumer''s idempotent append (insert ... on conflict (event_id) do nothing). Null for the pg-trigger and open paths.';

-- NATS at-least-once dedupe: one log row per delivered event id.
create unique index kb_resource_activity_event_id_key
  on kb.resource_activity (event_id)
  where event_id is not null;

-- node roll-up / per-resource history scan.
create index kb_resource_activity_resource_occurred_idx
  on kb.resource_activity (resource_id, occurred_at desc);

-- per-user recent / "opened by me" history (only user-bearing rows).
create index kb_resource_activity_user_space_occurred_idx
  on kb.resource_activity (user_id, space_id, occurred_at desc)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- same-space guard: the denormalized space_id must equal the node's space_id.
-- reuses the shared kb satellite guard built by the kb-satellites migration —
-- but that guard keys on new.node_id; this satellite keys on resource_id, so it
-- needs its own thin assertion. (Activity is 1:N, not the 1:1 node_id shape.)
-- ---------------------------------------------------------------------------
create or replace function kb.assert_resource_activity_same_space()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_node_space_id text;
begin
  select r.space_id into v_node_space_id
  from public.knowledge_resources r
  where r.id = new.resource_id;

  if v_node_space_id is null then
    raise exception 'kb.resource_activity references unknown resource_id %', new.resource_id;
  end if;

  if v_node_space_id <> new.space_id then
    raise exception 'kb.resource_activity.space_id must equal the resource''s space_id';
  end if;

  return new;
end;
$$;

comment on function kb.assert_resource_activity_same_space() is
  'Guards kb.resource_activity: the denormalized space_id (for RLS/index performance) must equal the parent node''s space_id.';

create trigger resource_activity_same_space_guard
before insert on kb.resource_activity
for each row execute function kb.assert_resource_activity_same_space();

-- ---------------------------------------------------------------------------
-- RLS — append-only: read node-scoped + own-rows; INSERT split by source path;
-- NO user UPDATE/DELETE (cascade-delete from the node is the only deletion).
-- ---------------------------------------------------------------------------
alter table kb.resource_activity enable row level security;
revoke all on kb.resource_activity from public;
-- append-only for users: select + insert only (no update/delete grant).
grant select, insert on kb.resource_activity to authenticated;
-- service_role bypasses RLS but still needs the privilege for the NATS consumer append.
grant select, insert on kb.resource_activity to service_role;

-- SELECT: node-subordinate mirror (a row is visible iff the parent node is readable),
-- via the landed auth_user_can_access_resource (the ADR-0013 RLS-mirror, no self-fetch).
-- A user sees node-wide activity for nodes they can read; user_id-bearing rows are
-- ADDITIONALLY their own (the own-rows clause keeps another user's per-user rows hidden).
create policy "kb_resource_activity select node-scoped + own rows"
on kb.resource_activity for select to authenticated
using (
  (resource_activity.user_id is null or resource_activity.user_id = (select auth.uid()))
  and exists (
    select 1 from public.knowledge_resources r
    where r.id = resource_activity.resource_id
      and public.auth_user_can_access_resource(r.id, r.space_id, r.owner_user_id, r.visibility, 'space.knowledge.read')
  )
);

-- INSERT: only the user-initiated OPEN path passes through user RLS — gated by the
-- new space.knowledge.open verb, own-rows, and source='open'. The pg-trigger append
-- runs SECURITY DEFINER (its originating write was already authorized at that table's
-- own boundary); the NATS-consumer append uses service-role (trusted background ingest
-- of derived audit metadata, §0.3 carve-out). Neither passes through this policy.
create policy "kb_resource_activity insert own open rows"
on kb.resource_activity for insert to authenticated
with check (
  resource_activity.source = 'open'
  and resource_activity.kind = 'open'
  and resource_activity.user_id = (select auth.uid())
  and public.auth_user_can_access_in_space(
    resource_activity.space_id,
    'space.knowledge.open'
  )
);

-- NO update / delete policy for authenticated: the log is append-only; the only
-- deletion is the on-delete-cascade from the parent node.

-- ===========================================================================
-- (c) roll-up trigger — one AFTER INSERT on the log maintains both columns.
--     SECURITY DEFINER (pinned search_path) so it bumps the parent node / per-user
--     row regardless of which path appended; greatest() so re-delivery / out-of-order
--     never regresses recency.
-- ===========================================================================

create or replace function kb.rollup_resource_activity()
returns trigger
language plpgsql
security definer
set search_path = public, kb
as $$
begin
  -- always: advance node-grain recency. The roll-up writes ONLY last_activity_at;
  -- the origin trigger on knowledge_resources watches only user-facing columns, so
  -- this UPDATE cannot re-fire an activity append (loop-guard, §2.6).
  update public.knowledge_resources
    set last_activity_at = greatest(last_activity_at, new.occurred_at)
  where id = new.resource_id;

  -- additionally: advance per-user "opened by me" for the open path. The open-route
  -- upserts the resource_user_state anchor first (under the user's RLS), so the row
  -- exists; this only advances the timestamp.
  if new.user_id is not null and new.kind = 'open' then
    update public.resource_user_state
      set last_opened_at = greatest(last_opened_at, new.occurred_at)
    where user_id = new.user_id
      and resource_id = new.resource_id;
  end if;

  return null; -- AFTER trigger: return value ignored.
end;
$$;

comment on function kb.rollup_resource_activity() is
  'AFTER INSERT on kb.resource_activity: bumps knowledge_resources.last_activity_at always, and resource_user_state.last_opened_at when the row is a per-user open. SECURITY DEFINER + greatest() — path-agnostic and re-delivery-safe. Writes only last_activity_at on the node (loop-guard vs the origin trigger).';

create trigger resource_activity_rollup
after insert on kb.resource_activity
for each row execute function kb.rollup_resource_activity();

-- ===========================================================================
-- (d) Postgres-origin trigger — appends a `kra` row in the SAME transaction as a
--     satellite / edge / node write. SECURITY DEFINER so it can insert into the log
--     even though the caller's RLS does not grant the trigger insert path — the
--     ORIGINATING write was already authorized by that table's own RLS (authorize-at
--     -produce). source='pg-trigger', user_id null (system/space-wide).
--
--     DIRECTIVE — satellite machinery: EVERY future kb.* satellite (resource_link,
--     resource_media_meta, resource_provenance, resource_embedding, ...) attaches
--     this SAME function in its own landing migration, so any node touch via any
--     satellite flows to the log uniformly (ADR-0013 reset-mode growth). The function
--     branches on TG_TABLE_NAME to derive the affected node id(s) and the kind.
-- ===========================================================================

create or replace function kb.append_activity_from_origin()
returns trigger
language plpgsql
security definer
set search_path = public, kb
as $$
declare
  v_row record;          -- new on insert/update, old on delete
  v_kind text;
begin
  -- pick the surviving row image (delete carries only old).
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  if tg_table_schema = 'public' and tg_table_name = 'knowledge_edges' then
    -- an edge change is activity on BOTH endpoints: one log row per endpoint that
    -- STILL EXISTS. On a node delete the FK cascade fires this on the edge DELETE,
    -- but the node being deleted is already gone (or going) — recording activity for
    -- a vanishing node is meaningless and its kra rows cascade away anyway, so skip
    -- any endpoint whose node no longer exists (the kb.resource_activity FK + the
    -- same-space guard would otherwise reject it mid-cascade).
    insert into kb.resource_activity (space_id, resource_id, kind, source, occurred_at)
    select v_row.space_id, ep.id, 'edge_change', 'pg-trigger', timezone('utc', now())
    from (values (v_row.from_id), (v_row.to_id)) as ep(id)
    where exists (
      select 1 from public.knowledge_resources r where r.id = ep.id
    );
    return null;
  end if;

  if tg_table_schema = 'public' and tg_table_name = 'knowledge_resources' then
    -- a direct node write (title/status/metadata/body_ref/etc.). The trigger is
    -- attached WHEN (...) so it does not fire on the roll-up's last_activity_at-only
    -- write (loop-guard, §2.6). Only attached for INSERT/UPDATE (never DELETE), so
    -- the node always exists here.
    insert into kb.resource_activity (space_id, resource_id, kind, source, occurred_at)
    values (v_row.space_id, v_row.id, 'node_write', 'pg-trigger', timezone('utc', now()));
    return null;
  end if;

  -- kb.* satellites: 1:1 on a single node, keyed by node_id; the kind reflects the
  -- table (description_edit for resource_description; future satellites pass their own).
  -- Skip when the node is gone (satellite cascade-delete during a node delete).
  if exists (select 1 from public.knowledge_resources r where r.id = v_row.node_id) then
    v_kind := replace(tg_table_name, 'resource_', '') || '_edit';
    insert into kb.resource_activity (space_id, resource_id, kind, source, occurred_at)
    values (v_row.space_id, v_row.node_id, v_kind, 'pg-trigger', timezone('utc', now()));
  end if;
  return null;
end;
$$;

comment on function kb.append_activity_from_origin() is
  'Postgres-origin activity append (SECURITY DEFINER, in-txn): inserts kb.resource_activity (source=pg-trigger, user_id null) for the node(s) affected by a satellite / edge / node write — below the app, fires for every writer. Edges append for both endpoints; kb.* satellites key on node_id. EVERY future kb.* satellite attaches this function in its own migration.';

-- attach to kb.resource_description (the first kb satellite). Fires on any content
-- write to a node's description; the trigger derives the node id and kind.
create trigger resource_description_append_activity
after insert or update or delete on kb.resource_description
for each row execute function kb.append_activity_from_origin();

-- attach to public.knowledge_edges (both endpoints handled in the function).
-- INSERT/UPDATE only — NOT delete: an edge removal that matters is the node-delete
-- cascade (orphan-cascade BEFORE trigger deletes a child, whose FK then deletes the
-- edge), and firing an AFTER-DELETE append inside that nested cascade triggers
-- Postgres's "tuple already modified by current command" re-entrancy error. Recording
-- activity for an edge that vanishes with its node is moot anyway (those kra rows
-- cascade away), so the meaningful edge activity — create / move / relink — is fully
-- captured by insert + update. (A bare manual unlink is a minor recency miss the
-- node's other touches dominate.)
create trigger knowledge_edges_append_activity
after insert or update on public.knowledge_edges
for each row execute function kb.append_activity_from_origin();

-- attach to public.knowledge_resources (the node self-touch). WHEN-guarded to the
-- USER-FACING columns so the roll-up's last_activity_at-only UPDATE does NOT re-fire
-- an activity append (loop-guard, §2.6). updated_at/created_at and the new
-- last_activity_at roll-up column are deliberately EXCLUDED from the watch set.
create trigger knowledge_resources_append_activity
after insert on public.knowledge_resources
for each row execute function kb.append_activity_from_origin();

create trigger knowledge_resources_update_append_activity
after update on public.knowledge_resources
for each row
when (
  old.title is distinct from new.title
  or old.status is distinct from new.status
  or old.visibility is distinct from new.visibility
  or old.body_ref is distinct from new.body_ref
  or old.kind is distinct from new.kind
  or old.owner_user_id is distinct from new.owner_user_id
)
execute function kb.append_activity_from_origin();
