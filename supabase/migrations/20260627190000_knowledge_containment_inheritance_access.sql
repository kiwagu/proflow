/*
 * knowledge graph — owner-scoped, live containment access inheritance (ADR-0023).
 *
 * purpose
 * - add ONE new additive OR'd disjunct to knowledge-resource visibility: a node is
 *   readable if it OR an ANCESTOR folder (up the forward `contains` forest) is granted
 *   to the current user — but OWNER-SCOPED, so the cascade never exposes another owner's
 *   node merely filed into a shared folder. Folder-sharing now means what a file explorer
 *   implies: share a folder → its (owner-scoped) contents are readable; add a child →
 *   instantly visible; revoke → instantly gone. Zero re-grant, zero materialized state.
 *
 * mechanism (the load-bearing design)
 * - a NEW pure sub-function `knowledge_resource_inherited_grant(resource, owner, space)`
 *   walks `contains` edges UPWARD (child.to_id -> parent.from_id) with a `with recursive`
 *   CTE, space-scoped at every step, climbing ONLY where the parent folder is owned by the
 *   SAME owner as the node under evaluation (`parent.owner_user_id = p_owner_user_id` — the
 *   same-owner containment spine). There is NO `space.knowledge.access` / cross-owner-curator
 *   exception: inheritance is an implicit bulk cascade, so it must never carry a grant across
 *   an owner boundary even for an admin (admins keep EXPLICIT per-node re-share — a separate
 *   grant row, not this implicit cascade). The walk carries `parent.visibility` through the
 *   CTE so the broadcast-floor disjunct can read it. It is bounded `depth < 32` with `union`
 *   (dedup) for cycle-safety, and a walked ancestor confers READ via ANY conferring dimension
 *   the user satisfies: per-user grant OR cohort grant OR broadcast floor (space/organization,
 *   keeping the base space-membership+verb check for parity with the leaf-floor rule).
 *
 * additive & live (the invariants this preserves)
 * - the disjunct only ever WIDENS: it never defaults true (no granted ancestor ⇒ false),
 *   never fences, never narrows. It is LIVE — a new child placed into a granted folder is
 *   visible immediately (no backfill); revoking the folder grant removes the whole subtree's
 *   inherited visibility live (no orphaned state). Additive-OR holds: a descendant that ALSO
 *   has its own grant / floor / other-granted-ancestor survives the folder revoke.
 *
 * RETURNING-safe
 * - keyed on a separate edge/grant read, not the RETURNING row itself, so it composes under
 *   SELECT and under INSERT/UPDATE ... RETURNING (the new row need not be visible to the
 *   sub-query), exactly like the existing cohort + per-user grant sub-predicates.
 *
 * no new table, no new index (the reverse `contains` index
 * knowledge_edges (to_id, relation_type, position) already exists), no entity-id prefix.
 * see docs/knowledge-graph-plan.md.
 */

-- ---------------------------------------------------------------------------
-- inherited-grant predicate (recursive `contains` ancestor walk, owner-scoped)
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_resource_inherited_grant(
  p_resource_id text,
  p_owner_user_id uuid,
  p_space_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- INHERITED grant (ADR-0023): true iff some ANCESTOR folder of this node, reached by
  -- walking `contains` edges UPWARD (child.to_id -> parent.from_id), confers READ to the
  -- current user via a per-user grant OR a cohort grant OR a broadcast floor set ON that
  -- ancestor. The walk stays on the node owner's SAME-OWNER containment spine at EVERY step
  -- (`parent.owner_user_id = p_owner_user_id`) so it never exposes another owner's nested
  -- node — there is no access-manager exception (an admin's folder-share does NOT implicitly
  -- cascade across an owner boundary; the admin re-shares the third party's node EXPLICITLY).
  -- Additive — never defaults true; only ever WIDENS. Keyed on a separate edge/grant read,
  -- so it is RETURNING-safe (the new row need not be visible to the sub-query).
  with recursive ancestors as (
    -- seed: direct parent folders of the node, ONLY on the same-owner spine.
    select e.from_id as ancestor_id, parent.visibility as ancestor_visibility, 1 as depth
    from public.knowledge_edges e
    join public.knowledge_resources parent on parent.id = e.from_id
    where e.to_id = p_resource_id
      and e.relation_type = 'contains'
      and e.space_id = p_space_id
      and parent.owner_user_id = p_owner_user_id        -- same-owner containment spine
    union
    select e.from_id, parent.visibility, a.depth + 1
    from public.knowledge_edges e
    join public.knowledge_resources parent on parent.id = e.from_id
    join ancestors a on e.to_id = a.ancestor_id
    where e.relation_type = 'contains'
      and e.space_id = p_space_id
      and a.depth < 32                                  -- depth bound, cycle-safe via union (dedup)
      and parent.owner_user_id = p_owner_user_id        -- same-owner spine at every step
  )
  -- a granted ancestor confers READ via ANY conferring dimension the user satisfies. The
  -- floor branch keeps the base space-membership+verb requirement (parity with the leaf-floor
  -- rule) so it only widens WITHIN the space, never across it.
  select exists (
    select 1
    from ancestors a
    where public.knowledge_resource_user_grant(a.ancestor_id)        -- per-user grant on the folder
       or public.knowledge_resource_scope_member(a.ancestor_id)      -- cohort grant on the folder
       or (                                                          -- broadcast floor on the folder
         a.ancestor_visibility in ('space', 'organization')
         and public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.read')
       )
  );
$$;

comment on function public.knowledge_resource_inherited_grant(text, uuid, text) is
  'Inherited GRANT dimension (ADR-0023): true iff some ancestor folder of this node (walking `contains` upward, owner-scoped on the same-owner spine) confers READ via a per-user grant, cohort grant, or broadcast floor the current user satisfies. Additive (OR-composed top-level); never defaults true. Owner-scoped: never carries a grant across an owner boundary (no access-manager exception). Live: new child auto-visible, revoke removes the subtree with no materialized state. depth<32 + union are the cycle guard.';

revoke all on function public.knowledge_resource_inherited_grant(text, uuid, text) from public;
grant execute on function public.knowledge_resource_inherited_grant(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- helper rewrite — add EXACTLY ONE top-level OR line (inherited grant).
-- signature and all landed disjuncts are byte-identical otherwise; this is a
-- purely ADDITIVE widening of the hot read predicate (it can only ever grant
-- MORE reads, never fewer — it never narrows or fences).
-- ---------------------------------------------------------------------------

create or replace function public.auth_user_can_access_resource(
  p_resource_id text,
  p_space_id text,
  p_owner_user_id uuid,
  p_visibility text,
  p_verb text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Visibility model (ADR-0017 §1.5, extended by ADR-0023): ONE broadcast floor
  -- (visibility) + additive OR'd grants. The floor is the single broadcast dial;
  -- cohort/per-user/inherited grants only ever WIDEN. is_owner is intrinsic ("you see
  -- your own"), hierarchy is the supervisory branch. Parens are normative (ADR-0008 §1):
  -- the base space-membership check is INSIDE the broadcast/cohort branch so no branch
  -- leaks across spaces.
  --
  -- the row's identifying columns (id/space_id/owner_user_id/visibility) are passed IN by
  -- the policy rather than self-fetched: a self-fetch by id cannot see the row during an
  -- INSERT/UPDATE ... RETURNING (the new row is not yet visible to a sub-query in the same
  -- command), which would spuriously deny the RETURNING read. Every sub-predicate keyed on
  -- id (cohort, per-user, inherited) reads separate link/edge tables (visible regardless),
  -- so they are RETURNING-safe too.
  select
    -- intrinsic ownership: you always see what you own
    p_owner_user_id = (select auth.uid())
    -- base space-membership + (broadcast floor OR additive cohort grant)
    or (
      public.auth_user_can_access_in_space(p_space_id, p_verb)
      and (
        p_visibility in ('space', 'organization')
        or public.knowledge_resource_scope_member(p_resource_id)
      )
    )
    -- additive per-user grant (top-level OR, mirrors is_owner; same-space guard pins
    -- grantee + resource to one space at insert, so this cannot leak across spaces)
    or public.knowledge_resource_user_grant(p_resource_id)
    -- additive INHERITED grant (ADR-0023): a granted ANCESTOR folder up the owner-scoped
    -- `contains` spine confers READ. Owner-scoped (same-owner spine, no cross-owner cascade)
    -- and live; only ever WIDENS. Top-level OR — its authority rests on the ancestor grant.
    or public.knowledge_resource_inherited_grant(
         p_resource_id, p_owner_user_id, p_space_id)
    -- supervisory oversight (checks space membership INSIDE; no cross-space leak)
    or public.auth_user_manages_owner(p_owner_user_id, p_space_id);
$$;

comment on function public.auth_user_can_access_resource(text, text, uuid, text, text) is
  'Composes knowledge-resource hard-access (ADR-0017 §1.5 + ADR-0023): is_owner OR (base space+verb AND (visibility floor in space/organization OR cohort grant)) OR per-user grant OR inherited (owner-scoped containment-ancestor) grant OR manager hierarchy. The single helper every knowledge_resources SELECT policy references; the policy passes the row''s id/space_id/owner_user_id/visibility so it also works under INSERT/UPDATE ... RETURNING.';

revoke all on function public.auth_user_can_access_resource(text, text, uuid, text, text) from public;
grant execute on function public.auth_user_can_access_resource(text, text, uuid, text, text) to authenticated;
