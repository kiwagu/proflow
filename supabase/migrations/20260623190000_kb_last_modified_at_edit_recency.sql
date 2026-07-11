/*
 * knowledge_resources.last_modified_at — an EDIT-only recency signal
 * (see docs/knowledge-graph-plan.md). Forward-only.
 *
 * why
 * - The Drive shell's "Modified" column reads knowledge_resources.updated_at, which
 *   only bumps on NODE-ROW writes (rename / status / move / body_ref bridge). It does
 *   NOT reflect document BODY edits (the body lives outside this row) nor
 *   kb.resource_description (satellite) edits — so editing a document's content leaves
 *   "Modified" stale.
 * - last_activity_at is honest about ALL activity but ALSO bumps on opens/views (every
 *   kb.resource_activity row, including kind='open'), so it is NOT a clean "modified"
 *   signal either.
 * - This adds last_modified_at: advanced by EVERY non-open (edit) activity row, but
 *   NEVER by an open/view. It is the clean user-facing "Modified" recency the column wants.
 *
 * what changes
 *   (1) public.knowledge_resources.last_modified_at — new not-null column, backfilled
 *       from greatest(updated_at, created_at); its own (space_id, last_modified_at desc)
 *       sort index for the "Modified" column.
 *   (2) kb.rollup_resource_activity() — CREATE OR REPLACE preserving the full current
 *       body (always-bump last_activity_at + the per-user open UPSERT of
 *       resource_user_state.last_opened_at), ADDING an edit-only bump of last_modified_at
 *       for rows where kind <> 'open'.
 *
 * loop-guard (verified, unchanged): the Postgres-origin trigger on knowledge_resources
 * (kb.append_activity_from_origin) fires only on writes to USER-FACING columns
 * (title / status / visibility / body_ref / kind / owner_user_id). last_modified_at,
 * like last_activity_at, is NOT in that WHEN-guard watch set, so the roll-up's
 * last_modified_at-only / last_activity_at-only UPDATE cannot re-fire an activity append
 * (a last_modified_at-only update appends zero kra rows).
 */

-- ===========================================================================
-- (1) the EDIT-only recency column + its sort index.
-- ===========================================================================

-- not null with a creation default so the read path never sorts on NULLs; the
-- backfill below keeps it correct forward (a no-op on a fresh reset-mode DB).
alter table public.knowledge_resources
  add column last_modified_at timestamptz not null default timezone('utc', now());

comment on column public.knowledge_resources.last_modified_at is
  'Edit-only recency roll-up (node grain): greatest occurred_at over NON-open kb.resource_activity rows for this node. The user-facing "Modified" signal — unlike updated_at it reflects body/description edits, and unlike last_activity_at it ignores opens/views. Maintained by kb.rollup_resource_activity.';

-- backfill from the best edit-recency signal we have at landing time. greatest()
-- so a node never regresses below its own write/creation time. forward-correct;
-- a no-op when the table is empty (reset mode).
update public.knowledge_resources
  set last_modified_at = greatest(updated_at, created_at);

-- hot-path sort/filter index for the space-wide "Modified" column.
create index knowledge_resources_space_modified_idx
  on public.knowledge_resources (space_id, last_modified_at desc);

-- ===========================================================================
-- (2) roll-up trigger — add the edit-only last_modified_at bump.
--     CREATE OR REPLACE preserving the full current body (the always-bump of
--     last_activity_at and the per-user open UPSERT landed by
--     20260622200000_kb_rollup_upserts_user_anchor.sql); the only addition is the
--     kind <> 'open' bump of last_modified_at.
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

  -- a modification (NOT a mere view) advances the user-facing "Modified" recency.
  -- opens (kind='open') deliberately do NOT touch it. like last_activity_at this is
  -- not a user-facing column, so this UPDATE cannot re-fire an activity append.
  if new.kind <> 'open' then
    update public.knowledge_resources
      set last_modified_at = greatest(last_modified_at, new.occurred_at)
    where id = new.resource_id;
  end if;

  -- additionally: advance per-user "opened by me" for the open path. UPSERT the anchor —
  -- this function is SECURITY DEFINER, so the insert bypasses RLS and last_opened_at is
  -- honest for EVERY member (no progress-verb grant needed). This trigger OWNS the anchor:
  -- the open-route never writes resource_user_state.
  if new.user_id is not null and new.kind = 'open' then
    insert into public.resource_user_state (user_id, resource_id, space_id, last_opened_at)
    values (new.user_id, new.resource_id, new.space_id, new.occurred_at)
    on conflict (user_id, resource_id) do update
      set last_opened_at = greatest(public.resource_user_state.last_opened_at, excluded.last_opened_at);
  end if;

  return null; -- AFTER trigger: return value ignored.
end;
$$;

comment on function kb.rollup_resource_activity() is
  'AFTER INSERT on kb.resource_activity: bumps knowledge_resources.last_activity_at always; bumps knowledge_resources.last_modified_at for NON-open (edit) rows (the user-facing "Modified" signal — opens never advance it); and UPSERTS resource_user_state (advancing last_opened_at via greatest()) when the row is a per-user open. SECURITY DEFINER so the anchor insert bypasses RLS — last_opened_at is honest for every member with no progress-verb grant. This trigger OWNS the per-user anchor; the open-route never writes resource_user_state. Writes only last_activity_at / last_modified_at on the node (loop-guard vs the origin trigger).';
