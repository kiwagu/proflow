-- ---------------------------------------------------------------------------
-- D9 — owner-sovereign visibility (broadcast floor) changes (ADR-0017 §3.4).
--
-- Changing a resource's `visibility` floor (private ↔ space ↔ organization) is an
-- AUDIENCE-management act, not ordinary content authoring. The general
-- knowledge_resources UPDATE policy gates on `space.knowledge.update` (any author
-- may edit any node's title/status/body) — too broad for the floor: it would let one
-- author silently re-broadcast (or hide) another author's content.
--
-- This BEFORE trigger tightens the floor column specifically to D9's owner-sovereign
-- rule: a visibility change is allowed ONLY for the resource OWNER (manages the
-- audience of their own content) or a space access-manager (`space.knowledge.access`,
-- the admin tier). Ordinary edits (title/status/body/edges) are unaffected — the
-- trigger fires only when `visibility` actually changes.
--
-- INSERTs are NOT gated here (creation chooses the initial floor via the create path
-- + column default); this is purely about CHANGING an existing node's broadcast floor.
-- ---------------------------------------------------------------------------

create or replace function public.assert_visibility_change_authorized()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.visibility is distinct from old.visibility then
    if not (
      old.owner_user_id = (select auth.uid())
      or public.auth_user_can_access_in_space(
        old.space_id,
        'space.knowledge.access'
      )
    ) then
      raise exception
        'visibility change requires resource ownership or space.knowledge.access'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.assert_visibility_change_authorized() is
  'D9 (ADR-0017 §3.4): a knowledge_resources.visibility (broadcast floor) change is owner-sovereign — allowed only for the resource owner or a space access-manager (space.knowledge.access). Other authoring (title/status/body) is unaffected.';

revoke all on function public.assert_visibility_change_authorized() from public;

create trigger knowledge_resources_visibility_change_guard
  before update of visibility on public.knowledge_resources
  for each row
  execute function public.assert_visibility_change_authorized();
