/*
 * knowledge graph — batched cohort-membership read for the "Shared with me" mechanism
 * annotation (see docs/knowledge-graph-plan.md §5).
 *
 * purpose
 * - the "Shared with me" lens annotates each visible-not-owned node with the mechanism
 *   that grants the CURRENT user access (personal grant > cohort grant > broadcast floor).
 *   the cohort check needs the set of scopes (cohorts) the current user belongs to,
 *   read in ONE batched call rather than per-node.
 *
 * why a security-definer helper (not a direct table read)
 * - scope_memberships SELECT RLS gates on the LEGACY content vocabulary
 *   (space.content.read), while a knowledge reader holds space.knowledge.read — the
 *   `member` system role holds knowledge.read but NOT content.read. so a direct
 *   under-RLS read of scope_memberships would return NOTHING for a plain member and
 *   under-report their cohort access (a cohort-granted node would mislabel as broadcast).
 * - the landed cohort PREDICATE (knowledge_resource_scope_member) is already
 *   security-definer for exactly this reason: it reads scope_memberships past that RLS.
 *   this helper is its BATCHED twin — same authority, returns the user's scope ids in one
 *   call so the annotation stays one read, not one-per-node.
 *
 * authorization posture (pure display enrichment, never a fence)
 * - this is NOT an access dimension and changes NO visibility. it returns ONLY the
 *   current user's OWN scope memberships (keyed on auth.uid() INSIDE the function), so it
 *   cannot disclose another user's memberships and cannot widen or narrow any node's
 *   visibility. the "Shared with me" set is already RLS-admitted upstream; this only
 *   labels WHY each already-visible node is visible. Invariant #1 holds: no new table,
 *   no resolver change, no new access dimension — one read-only helper over the landed
 *   scope_memberships rows.
 */

create or replace function public.knowledge_user_scope_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  -- the scopes (cohorts) the CURRENT user belongs to. keyed on auth.uid() INSIDE the
  -- function (never a parameter) so it can only ever return the caller's own memberships
  -- — it discloses no one else's, and decides no visibility. security-definer so it
  -- reads scope_memberships past its content-vocabulary SELECT RLS, mirroring the landed
  -- knowledge_resource_scope_member predicate's authority (its batched twin).
  select sm.scope_id
  from public.scope_memberships sm
  where sm.user_id = (select auth.uid());
$$;

comment on function public.knowledge_user_scope_ids() is
  'Batched cohort-membership read for the "Shared with me" mechanism annotation (ADR-0021 Part C): the scope ids the current user belongs to, in ONE call. Security-definer (the batched twin of knowledge_resource_scope_member) so a plain member — who holds space.knowledge.read but not the legacy space.content.read that gates scope_memberships SELECT RLS — still resolves their cohort access. Returns ONLY the caller''s own memberships (keyed on auth.uid() inside); pure display enrichment, never a fence, no new access dimension.';

revoke all on function public.knowledge_user_scope_ids() from public;
grant execute on function public.knowledge_user_scope_ids() to authenticated;
