/*
 * knowledge graph — owner_user_id population + created_by immutability
 * (2026-06-17 review findings #4 and #5). Forward-only corrective migration;
 * the graph DDL (20260615190243) and access dimensions (20260617190300) are
 * already applied, so this adds NEW triggers/backfill rather than editing them.
 *
 * finding #4 — the manager-hierarchy dimension is inert
 * - `auth_user_manages_owner(p_resource_owner, …)` short-circuits to false when
 *   the owner is null. `knowledge_resources.owner_user_id` is nullable and the
 *   INSERT policy never populates it, so most authoring paths leave it null and
 *   the entire hierarchy access dimension never grants anything.
 * - fix: a BEFORE INSERT trigger defaults `owner_user_id` to `created_by` when
 *   the caller did not supply it, so the owner is consistently set and can never
 *   be silently null. Existing rows are backfilled. (Authoring paths that DO set
 *   an explicit owner — e.g. the body fan-out — are unaffected.)
 *
 * finding #5 — mutable created_by transfers body-bridge authority
 * - `rpc_enqueue_body_bridge_job` gates on `knowledge_resources.created_by =
 *   auth.uid()`. The UPDATE policy's WITH CHECK never re-asserts `created_by`, so
 *   an editor with space.knowledge.update can rewrite `created_by` and hijack the
 *   body-bridge creator authority for a node they do not own.
 * - fix: a BEFORE UPDATE trigger pins `created_by` to its OLD value (any attempt
 *   to change it is rejected). Immutability is enforced at the row level, so it
 *   holds for every update path (RLS policy, RPC, or service-role app code).
 *
 * No core graph schema change (no new column/table/ALTER) — only triggers + a
 * one-time data backfill.
 */

-- ---------------------------------------------------------------------------
-- finding #4 — default owner_user_id to created_by on insert + backfill
-- ---------------------------------------------------------------------------

create or replace function public.set_knowledge_resource_owner_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- owner defaults to the creator unless explicitly provided, so the hierarchy
  -- access dimension always has a non-null owner to resolve against.
  if new.owner_user_id is null then
    new.owner_user_id := new.created_by;
  end if;
  return new;
end;
$$;

comment on function public.set_knowledge_resource_owner_default() is
  'Defaults knowledge_resources.owner_user_id to created_by on insert so the manager-hierarchy access dimension is never inert (review finding #4).';

drop trigger if exists knowledge_resources_set_owner_default
  on public.knowledge_resources;
create trigger knowledge_resources_set_owner_default
before insert on public.knowledge_resources
for each row
execute function public.set_knowledge_resource_owner_default();

-- one-time backfill of rows inserted before the trigger existed. Only rows whose
-- creator still exists in auth.users are backfilled — owner_user_id has an FK to
-- auth.users, and an orphaned creator (deleted user) could never satisfy the
-- hierarchy predicate anyway, so such rows correctly stay null.
update public.knowledge_resources kr
set owner_user_id = kr.created_by
where kr.owner_user_id is null
  and exists (
    select 1 from auth.users u where u.id = kr.created_by
  );

-- ---------------------------------------------------------------------------
-- finding #5 — make created_by immutable on update
-- ---------------------------------------------------------------------------

create or replace function public.assert_knowledge_resource_created_by_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- created_by gates body-bridge creator authority; it must never be reassigned.
  if new.created_by is distinct from old.created_by then
    raise exception
      'knowledge_resources.created_by is immutable and cannot be reassigned';
  end if;
  return new;
end;
$$;

comment on function public.assert_knowledge_resource_created_by_immutable() is
  'Pins knowledge_resources.created_by to its original value on update so body-bridge creator authority cannot be transferred (review finding #5).';

drop trigger if exists knowledge_resources_created_by_immutable
  on public.knowledge_resources;
create trigger knowledge_resources_created_by_immutable
before update on public.knowledge_resources
for each row
execute function public.assert_knowledge_resource_created_by_immutable();
