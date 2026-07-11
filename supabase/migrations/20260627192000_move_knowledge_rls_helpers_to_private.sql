/*
 * purpose:
 *   close the supabase advisor `authenticated_security_definer_function_executable`
 *   on the knowledge RLS-internal SECURITY DEFINER helpers by moving them OUT of the
 *   PostgREST-exposed `public` schema into a non-exposed `private` schema (the lockdown
 *   migration 20260627191100 noted this as the deferred "high-blast-radius follow-up";
 *   the supabase-postgres-best-practices skill recommends the same — secdef helpers in a
 *   non-exposed schema).
 *
 * what moves (knowledge RLS-internal helpers — referenced only by the knowledge_resources
 * RLS policy and by each other, NEVER called by the app via PostgREST — verified against
 * every app `.rpc(...)` call):
 *   - auth_user_can_access_resource(text,text,uuid,text,text)   [the policy's top helper]
 *   - knowledge_resource_inherited_grant(text,uuid,text)
 *   - knowledge_resource_scope_member(text)
 *   - knowledge_resource_user_grant(text)
 *   - auth_user_manages_owner(uuid,text)
 *
 * what STAYS in public (app calls them by name via PostgREST, or RLS+app dual-use):
 *   - auth_user_can_access_in_space, auth_user_has_permission, knowledge_user_scope_ids,
 *     space_member_directory, all rpc_*  (out of scope here)
 *
 * mechanics:
 *   - `alter function ... set schema private` PRESERVES the function OID, so the
 *     knowledge_resources RLS policy (which references auth_user_can_access_resource by
 *     OID) auto-follows the move with NO policy edit and NO behaviour change.
 *   - the moved functions qualify their inter-helper calls as `public.X`; after the move
 *     those names no longer resolve, so the two callers (auth_user_can_access_resource,
 *     knowledge_resource_inherited_grant) are `create or replace`d with `private.X` for the
 *     moved helpers (calls to STAYING helpers/tables keep `public.`). Same OID (replace) →
 *     the policy reference is unaffected.
 *   - authenticated keeps EXECUTE (rls evaluation needs it) but gains it only in a
 *     non-exposed schema, so PostgREST cannot route to these helpers → advisor clears.
 *     `grant usage on schema private to authenticated` lets the policy-evaluated top helper
 *     resolve; the inner helpers are reached inside the security-definer owner context.
 *
 * special considerations:
 *   - reset-mode: forward-only; this migration is the LAST to touch these five functions,
 *     so a fresh `db reset` lands them in `private` with the corrected bodies.
 *   - `private` is NOT in PGRST_DB_SCHEMAS (public,storage,kb), so nothing here is REST-reachable.
 */

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- 1) relocate all five helpers (OID preserved → the knowledge_resources policy follows).
alter function public.knowledge_resource_user_grant(text) set schema private;
alter function public.knowledge_resource_scope_member(text) set schema private;
alter function public.auth_user_manages_owner(uuid, text) set schema private;
alter function public.knowledge_resource_inherited_grant(text, uuid, text) set schema private;
alter function public.auth_user_can_access_resource(text, text, uuid, text, text) set schema private;

-- 2) re-qualify the two helpers that call MOVED helpers: public.X -> private.X for the moved
--    set; calls to STAYING helpers (auth_user_can_access_in_space) and tables keep `public.`.
create or replace function private.knowledge_resource_inherited_grant(p_resource_id text, p_owner_user_id uuid, p_space_id text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  with recursive ancestors as (
    select e.from_id as ancestor_id, parent.visibility as ancestor_visibility, 1 as depth
    from public.knowledge_edges e
    join public.knowledge_resources parent on parent.id = e.from_id
    where e.to_id = p_resource_id
      and e.relation_type = 'contains'
      and e.space_id = p_space_id
      and parent.owner_user_id = p_owner_user_id
    union
    select e.from_id, parent.visibility, a.depth + 1
    from public.knowledge_edges e
    join public.knowledge_resources parent on parent.id = e.from_id
    join ancestors a on e.to_id = a.ancestor_id
    where e.relation_type = 'contains'
      and e.space_id = p_space_id
      and a.depth < 32
      and parent.owner_user_id = p_owner_user_id
  )
  select exists (
    select 1
    from ancestors a
    where private.knowledge_resource_user_grant(a.ancestor_id)
       or private.knowledge_resource_scope_member(a.ancestor_id)
       or (
         a.ancestor_visibility in ('space', 'organization')
         and public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.read')
       )
  );
$function$;

create or replace function private.auth_user_can_access_resource(p_resource_id text, p_space_id text, p_owner_user_id uuid, p_visibility text, p_verb text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    p_owner_user_id = (select auth.uid())
    or (
      public.auth_user_can_access_in_space(p_space_id, p_verb)
      and (
        p_visibility in ('space', 'organization')
        or private.knowledge_resource_scope_member(p_resource_id)
      )
    )
    or private.knowledge_resource_user_grant(p_resource_id)
    or private.knowledge_resource_inherited_grant(
         p_resource_id, p_owner_user_id, p_space_id)
    or private.auth_user_manages_owner(p_owner_user_id, p_space_id);
$function$;
