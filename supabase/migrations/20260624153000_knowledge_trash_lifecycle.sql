/*
 * knowledge graph — Trash / reference-aware soft-delete lifecycle
 * (see docs/knowledge-graph-plan.md, Trash section).
 *
 * Adds a reversible holding state ("Trash") between live and destroyed for
 * knowledge_resources, so a delete no longer severs references (shortcuts,
 * cross-folder containment, relates_to/tagged edges, the Payload body) with no
 * undo. Destruction stays, but moves to a separate, deliberate `purge` (a real
 * DELETE) reached only from the Trash lens.
 *
 * Lifecycle is a THIRD axis, orthogonal to access (visibility) and workflow
 * (status): a nullable `deleted_at` timestamp (NULL = live). It is NEVER merged
 * into status or visibility, and the trashed/normal split is a query lens, not an
 * access fence — the access fence (auth_user_can_access_resource) is unchanged.
 *
 * what this migration builds (Postgres/data layer only — the Trash lens UI lands
 * in its own work):
 *   1. lifecycle columns deleted_at + trashed_by on knowledge_resources, + a
 *      partial (space_id, deleted_at) index for the two hot paths.
 *   2. edge visibility: a trashed endpoint hides the edge (one extra per-endpoint
 *      conjunct on the landed both-endpoints-visible edge SELECT policy). NOT added
 *      to the access helper — trash is lifecycle, not access.
 *   3. soft-cascade trigger kb_cascade_trash_containment_orphans: trashing a folder
 *      soft-deletes its contains-children that lose their last LIVING parent; a
 *      multi-parent child with a living parent survives. Same timestamp across the
 *      cascade (so restore can detect "trashed as a unit"). SECURITY DEFINER for its
 *      GRAPH-TRAVERSAL reads only (the parent it walks from is ALREADY trashed, so
 *      its contains-edges are now dormant/hidden by fork #2 — an invoker read would
 *      see nothing and cascade nothing); the per-row AUTHORITY stays enforced by the
 *      separate BEFORE-UPDATE guard (#4), which fires on every cascaded child too.
 *   4. authority guard assert_trash_change_authorized: a deleted_at change (trash
 *      OR restore) is owner-sovereign OR space.knowledge.delete — the delete-tier,
 *      parity with the landed visibility guard. NO new verb.
 *   5. in-use purge guard assert_purge_not_in_use: a real DELETE (purge) of a row
 *      with LIVING cross-owner references is blocked unless the caller holds
 *      space.knowledge.delete (cooperative destruction of a depended-on asset).
 *   6. lifecycle audit trail (no new table): the landed kb.resource_activity spine
 *      emits kind='trashed'/'restored' (actor-stamped) on the deleted_at
 *      transition; a BEFORE DELETE trigger writes one durable
 *      space_admin_audit_log row (action='knowledge.resource.purged') that
 *      outlives the node + its FK-cascaded kra rows.
 *
 * RLS stays the sole authority: every function is SECURITY INVOKER unless it must
 * write a satellite/log the user cannot insert directly (the activity append +
 * the durable purge audit are SECURITY DEFINER, mirroring the landed precedents).
 * No service-role anywhere. No new entity-id prefix (reuses knr / kra / sal).
 *
 * Invariant #1 intact: Trash is two columns + dormant edges + a query lens over
 * the ONE graph — no tombstone table, no parallel model.
 */

-- ===========================================================================
-- 1. lifecycle columns (orthogonal to status + visibility)
-- ===========================================================================

-- deleted_at: NULL = live; set = trashed (and the recency/ordering signal the
-- Trash lens sorts by). No default → all existing rows are live (correct).
-- trashed_by: who currently holds the node trashed (current-state, cleared on
-- restore — NOT history; history is the kb.resource_activity spine below).
alter table public.knowledge_resources
  add column deleted_at timestamptz,
  add column trashed_by uuid references auth.users (id) on delete set null;

comment on column public.knowledge_resources.deleted_at is
  'Lifecycle timestamp (third axis, orthogonal to visibility/status): NULL = live, set = trashed. The trashed/normal split is a query lens, not an access fence. Restore clears it; purge is a real DELETE.';
comment on column public.knowledge_resources.trashed_by is
  'Current trasher (convenience pointer, cleared on restore) — NOT the audit record. Trash/restore history is the append-only kb.resource_activity spine (kind=trashed/restored).';

-- the Trash lens (deleted_at IS NOT NULL) and the exclude-trashed predicate
-- (deleted_at IS NULL) are the two hot paths.
create index knowledge_resources_space_id_deleted_at_idx
  on public.knowledge_resources (space_id, deleted_at);

-- ===========================================================================
-- 2. edge visibility — a trashed endpoint hides the edge (preserve-but-dormant).
--    Trashing writes NOTHING to edges; the edge rows stay. What changes is
--    visibility: an edge whose from- or to-endpoint is trashed is not selected,
--    so no dangling edge to a trashed node ever reaches the client (graceful-
--    absence by construction). Restore clears deleted_at → every edge reappears.
--    This is the landed both-endpoints-visible policy plus a per-endpoint
--    deleted_at IS NULL conjunct on the SAME fetched rows. It is NOT added to
--    auth_user_can_access_resource (the access fence — trash is not access).
-- ===========================================================================

drop policy "knowledge_edges select for scoped readers" on public.knowledge_edges;

create policy "knowledge_edges select for scoped readers"
on public.knowledge_edges
for select
to authenticated
using (
  -- base space read on the edge's own space (unchanged floor) ...
  public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.read'
  )
  -- ... AND the from-endpoint is access-visible AND not trashed ...
  and exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_edges.from_id
      and r.deleted_at is null
      and public.auth_user_can_access_resource(
        r.id,
        r.space_id,
        r.owner_user_id,
        r.visibility,
        'space.knowledge.read'
      )
  )
  -- ... AND the to-endpoint is access-visible AND not trashed. A trashed endpoint
  -- makes the edge dormant (hidden, never pruned) — it reappears on restore.
  and exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_edges.to_id
      and r.deleted_at is null
      and public.auth_user_can_access_resource(
        r.id,
        r.space_id,
        r.owner_user_id,
        r.visibility,
        'space.knowledge.read'
      )
  )
);

-- ===========================================================================
-- 3. soft-cascade trigger — mirror the landed hard orphan cascade, SOFT.
--    AFTER UPDATE OF deleted_at, fires only on a live→trashed transition. Stamps
--    the SAME deleted_at + trashed_by on contains-children that lose their last
--    LIVING parent; a multi-parent child with a living parent survives (its edge
--    to the trashed folder is dormant, not deleted). SECURITY DEFINER for its
--    GRAPH-TRAVERSAL reads: when this AFTER trigger fires, `old` is ALREADY trashed,
--    so its contains-edges are dormant (hidden by the fork #2 edge-visibility
--    policy) — an invoker read would return nothing and cascade nothing. A definer
--    read sees the true graph. The per-row AUTHORITY is NOT relaxed: the §4
--    BEFORE-UPDATE guard fires on EVERY cascaded child UPDATE here too, so the
--    cascade can still only trash rows the caller could already trash; the
--    `not exists` multi-parent guard additionally sees ALL parents (incl. other-
--    owner) so orphan-hood is judged honestly. Recursion: stamping a child re-fires
--    this AFTER trigger, walking the orphaned sub-forest (acyclic by construction).
-- ===========================================================================

create or replace function public.kb_cascade_trash_containment_orphans()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- stamp the SAME timestamp/actor across the cascade so restore can detect the
  -- subtree trashed AS A UNIT (equal deleted_at + trashed_by).
  update public.knowledge_resources child
  set deleted_at = new.deleted_at,
      trashed_by = new.trashed_by
  where child.space_id = old.space_id
    and child.deleted_at is null
    and child.id in (
      select e.to_id
      from public.knowledge_edges e
      where e.from_id = old.id
        and e.relation_type = 'contains'
    )
    -- the only delta from the hard trigger: a LIVING other parent (p.deleted_at
    -- is null) keeps the child alive. A trashed other parent does not save it.
    and not exists (
      select 1
      from public.knowledge_edges other_parent
      join public.knowledge_resources p on p.id = other_parent.from_id
      where other_parent.to_id = child.id
        and other_parent.relation_type = 'contains'
        and other_parent.from_id <> old.id
        and p.deleted_at is null
    );
  return null;
end;
$$;

comment on function public.kb_cascade_trash_containment_orphans() is
  'AFTER UPDATE OF deleted_at (live->trashed) on knowledge_resources: recursively soft-deletes contains-children that lose their last LIVING parent (orphans); a multi-parent child with a living parent survives. Stamps the SAME deleted_at/trashed_by across the cascade (restore detects trashed-as-a-unit). SECURITY DEFINER for its graph-traversal reads (old is already trashed -> its edges are dormant/hidden, so an invoker read would cascade nothing); per-row authority stays enforced by the BEFORE-UPDATE trash guard which fires on every cascaded child. Mirrors kb_cascade_delete_containment_orphans, soft.';

drop trigger if exists knowledge_resources_cascade_trash_orphans
  on public.knowledge_resources;

create trigger knowledge_resources_cascade_trash_orphans
after update of deleted_at on public.knowledge_resources
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function public.kb_cascade_trash_containment_orphans();

-- ===========================================================================
-- 4. lifecycle-authority guard — parity with assert_visibility_change_authorized.
--    BEFORE UPDATE OF deleted_at: a deleted_at change (trash OR restore — same
--    verb) is allowed ONLY for the resource owner or a space.knowledge.delete
--    holder (the delete-tier, NOT the wider update-tier). Ordinary authoring
--    (title/status/body/edges) never touches deleted_at and is unaffected.
--    SECURITY DEFINER (parity with the landed guard) so auth_user_can_access_in_space
--    resolves against the caller's claims regardless of the row's RLS.
-- ===========================================================================

create or replace function public.assert_trash_change_authorized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    if not (
      old.owner_user_id = (select auth.uid())
      or public.auth_user_can_access_in_space(
        old.space_id,
        'space.knowledge.delete'
      )
    ) then
      raise exception
        'trash/restore requires resource ownership or space.knowledge.delete'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.assert_trash_change_authorized() is
  'Fork #5 (ADR-0018): a knowledge_resources.deleted_at change (trash OR restore) is owner-sovereign — allowed only for the resource owner or a space.knowledge.delete holder (the delete-tier). No new verb. Parity with assert_visibility_change_authorized.';

revoke all on function public.assert_trash_change_authorized() from public;

create trigger knowledge_resources_trash_change_guard
  before update of deleted_at on public.knowledge_resources
  for each row
  execute function public.assert_trash_change_authorized();

-- ===========================================================================
-- 5. in-use purge guard — block destroying a depended-on asset unilaterally.
--    BEFORE DELETE: if the row has LIVING cross-owner references (a contains/
--    shortcut/relates_to/tagged edge from a LIVE node owned by someone else), the
--    caller must hold space.knowledge.delete (cross-owner authority). An owner
--    purging their own trashed leaf with no cross-owner references is unaffected.
--    The landed hard orphan-cascade trigger (kb_cascade_delete_containment_orphans)
--    coexists on the same DELETE and destroys orphaned descendants unchanged.
--    SECURITY DEFINER so the verb check resolves against the caller's claims.
-- ===========================================================================

create or replace function public.assert_purge_not_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.knowledge_edges e
    join public.knowledge_resources other
      on other.id = case
                      when e.from_id = old.id then e.to_id
                      else e.from_id
                    end
    where (e.from_id = old.id or e.to_id = old.id)
      and e.relation_type in ('contains', 'shortcut', 'relates_to', 'tagged')
      and other.id <> old.id
      and other.deleted_at is null
      and other.owner_user_id is distinct from (select auth.uid())
  ) then
    if not public.auth_user_can_access_in_space(
      old.space_id,
      'space.knowledge.delete'
    ) then
      raise exception
        'purge of an in-use resource (living cross-owner references) requires space.knowledge.delete'
        using errcode = '42501';
    end if;
  end if;
  return old;
end;
$$;

comment on function public.assert_purge_not_in_use() is
  'Fork #5 (ADR-0018): a purge (real DELETE) of a knowledge_resource with LIVING cross-owner references (contains/shortcut/relates_to/tagged from a live node owned by another user) is blocked unless the caller holds space.knowledge.delete — cooperative destruction of a depended-on asset (graceful-absence cannot restore a purged row). Security invoker semantics via definer claims.';

revoke all on function public.assert_purge_not_in_use() from public;

-- BEFORE DELETE, ordered before the landed orphan-cascade trigger by name
-- (kb… sorts after assert… is not guaranteed; Postgres fires BEFORE-row triggers
-- alphabetically, so name this guard to sort FIRST: 'aa_' prefix). The guard must
-- run before the cascade so an unauthorized purge aborts before any child is
-- destroyed.
drop trigger if exists aa_knowledge_resources_purge_in_use_guard
  on public.knowledge_resources;

create trigger aa_knowledge_resources_purge_in_use_guard
  before delete on public.knowledge_resources
  for each row
  execute function public.assert_purge_not_in_use();

-- ===========================================================================
-- 6a. lifecycle audit (trash/restore) — extend the landed kb activity spine.
--     Watch deleted_at in the WHEN guard so the origin trigger fires on a
--     trash/restore, and emit kind='trashed'/'restored' (ACTOR-stamped, unlike
--     the system node_write rows) on the deleted_at transition. No new table.
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
    -- STILL EXISTS (skip a vanishing endpoint mid-cascade).
    insert into kb.resource_activity (space_id, resource_id, kind, source, occurred_at)
    select v_row.space_id, ep.id, 'edge_change', 'pg-trigger', timezone('utc', now())
    from (values (v_row.from_id), (v_row.to_id)) as ep(id)
    where exists (
      select 1 from public.knowledge_resources r where r.id = ep.id
    );
    return null;
  end if;

  if tg_table_schema = 'public' and tg_table_name = 'knowledge_resources' then
    -- a deleted_at transition is a LIFECYCLE act (trash/restore) — emit the
    -- specific kind, ACTOR-stamped (user_id = auth.uid()), so the spine records
    -- WHO trashed/restored. Otherwise a generic node_write (system, user_id null).
    -- The pg-origin trigger is SECURITY DEFINER, so this INSERT bypasses the
    -- user open-only INSERT policy; setting user_id to the actor is therefore fine.
    if tg_op = 'UPDATE'
       and (old.deleted_at is distinct from new.deleted_at) then
      if old.deleted_at is null and new.deleted_at is not null then
        v_kind := 'trashed';
      elsif old.deleted_at is not null and new.deleted_at is null then
        v_kind := 'restored';
      else
        v_kind := 'node_write';
      end if;
      insert into kb.resource_activity (space_id, resource_id, user_id, kind, source, occurred_at)
      values (v_row.space_id, v_row.id, (select auth.uid()), v_kind, 'pg-trigger', timezone('utc', now()));
      return null;
    end if;

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
  'Postgres-origin activity append (SECURITY DEFINER, in-txn): inserts kb.resource_activity for the node(s) affected by a satellite / edge / node write. A deleted_at transition emits kind=trashed/restored ACTOR-stamped (user_id=auth.uid()); other node writes stay node_write (system, user_id null). Edges append for both endpoints; kb.* satellites key on node_id. EVERY future kb.* satellite attaches this function in its own migration.';

-- extend the WHEN watch set to ALSO fire on a deleted_at change. The roll-up's
-- last_activity_at/last_modified_at-only UPDATE still does not fire (those columns
-- are not in the watch set — loop-guard intact).
drop trigger if exists knowledge_resources_update_append_activity
  on public.knowledge_resources;

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
  or old.deleted_at is distinct from new.deleted_at
)
execute function kb.append_activity_from_origin();

-- ===========================================================================
-- 6b. durable purge history — one space_admin_audit_log row that OUTLIVES the
--     node. BEFORE DELETE (the row is still readable for the snapshot, and fires
--     before the FK cascade reaps the kra rows). The audit log forbids mutation
--     and nullifies FKs, so this record persists after the node + its kra rows
--     are gone — the durable tombstone of the one-way door. SECURITY DEFINER and
--     actor-stamped to auth.uid() (the log INSERT policy requires actor = self;
--     definer + explicit actor satisfies it for every caller / future REST/MCP).
-- ===========================================================================

create or replace function public.emit_knowledge_resource_purged_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_organization_id text;
begin
  select s.organization_id into v_organization_id
  from public.spaces s
  where s.id = old.space_id;

  insert into public.space_admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    organization_id,
    space_id,
    previous_value,
    new_value
  )
  values (
    v_actor,
    'knowledge.resource.purged',
    'knowledge_resource',
    old.id,
    v_organization_id,
    old.space_id,
    jsonb_build_object(
      'title', old.title,
      'kind', old.kind,
      'owner_user_id', old.owner_user_id,
      'space_id', old.space_id,
      'deleted_at', old.deleted_at,
      'trashed_by', old.trashed_by
    ),
    null
  );
  return old;
end;
$$;

comment on function public.emit_knowledge_resource_purged_audit() is
  'BEFORE DELETE on knowledge_resources: writes one durable space_admin_audit_log row (action=knowledge.resource.purged) that OUTLIVES the node and its FK-cascaded kra rows (the log forbids mutation + nullifies FKs). SECURITY DEFINER, actor-stamped to auth.uid(). The durable tombstone of the purge one-way door, for every caller.';

revoke all on function public.emit_knowledge_resource_purged_audit() from public;

-- BEFORE DELETE. Names sort: aa_…purge_in_use_guard (authorize) → ab_…purged_audit
-- (snapshot) → knowledge_resources_cascade_orphans (destroy descendants). The
-- audit must capture OLD before the orphan-cascade reaps anything, so name it to
-- sort after the guard but before the cascade.
drop trigger if exists ab_knowledge_resources_purged_audit
  on public.knowledge_resources;

create trigger ab_knowledge_resources_purged_audit
  before delete on public.knowledge_resources
  for each row
  execute function public.emit_knowledge_resource_purged_audit();
