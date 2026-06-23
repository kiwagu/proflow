/*
 * kb.rollup_resource_activity — own the per-user anchor (UPSERT, not UPDATE).
 * Forward-only `create or replace` of the roll-up trigger function landed by
 * 20260622193000_kb_resource_activity_and_recency.sql (see docs/knowledge-graph-plan.md).
 *
 * why
 * - The per-user "opened by me" roll-up advances public.resource_user_state.last_opened_at.
 *   The prior body UPDATE-d that anchor and relied on the open-route having upserted the
 *   anchor row first. But the open-route's anchor write is gated by space.knowledge.progress,
 *   which only admin/author hold — NOT a plain member. So a member's authoritative `open`
 *   log row landed, yet the anchor never existed and last_opened_at never advanced: the
 *   roll-up was dishonest for every member.
 * - This function is SECURITY DEFINER, so an INSERT here bypasses RLS. Making the per-user
 *   branch UPSERT the anchor makes last_opened_at honest for EVERY member — with NO new verb
 *   grant and NO new policy (granting member the `progress` verb would be a semantic
 *   over-grant). The open-route now owns no resource_user_state write at all; this trigger
 *   owns anchor creation.
 *
 * what changes
 * - ONLY the per-user branch: UPDATE -> INSERT ... ON CONFLICT (user_id, resource_id) DO
 *   UPDATE with greatest(). coarse_status falls to its NOT NULL DEFAULT 'not_started' on
 *   insert; the same-space guard on resource_user_state passes (the kra row's space_id is
 *   the resource's); the updated_at trigger fires normally on the conflict-update path.
 * - The node-grain last_activity_at UPDATE and the loop-guard are UNCHANGED.
 */

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
  'AFTER INSERT on kb.resource_activity: bumps knowledge_resources.last_activity_at always, and UPSERTS resource_user_state (advancing last_opened_at via greatest()) when the row is a per-user open. SECURITY DEFINER so the anchor insert bypasses RLS — last_opened_at is honest for every member with no progress-verb grant. This trigger OWNS the per-user anchor; the open-route never writes resource_user_state. Writes only last_activity_at on the node (loop-guard vs the origin trigger).';
