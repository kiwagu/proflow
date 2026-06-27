/*
 * purpose:
 *   forward security hardening for the supabase security advisor (splinter).
 *   the app is auth-only behind the gateway; the supabase default privileges on
 *   the public schema (alter default privileges ... grant execute on functions
 *   to anon, authenticated) silently re-grant execute on every new public
 *   function, which the advisor flags as
 *   anon_security_definer_function_executable /
 *   authenticated_security_definer_function_executable.
 *
 *   this migration:
 *     1. revokes execute from anon on EVERY security definer function in public
 *        (the unauthenticated role must never reach the knowledge/content/admin
 *        rpc surface; no anon/public rls policy references these helpers, verified).
 *     2. revokes select from anon on the content/knowledge/admin tables that the
 *        advisor flagged as exposed (all have rls enabled with zero anon policies,
 *        so anon already reads no rows — this removes the unused grant, fail-closed).
 *     3. revokes execute from authenticated on the trigger-only and
 *        service-role-only security definer functions that the app never calls
 *        via postgrest (restores their originally-intended service_role-only /
 *        trigger-internal reach; verified each has 0 rls-policy references and is
 *        not called from app code).
 *
 * affected objects: privileges only (no behavior change for legit authenticated
 *   resolves; rls still governs every read).
 *
 * special considerations:
 *   - forward-only privilege revokes; idempotent (revoke is safe to re-run).
 *   - rls-helper functions referenced directly inside authenticated rls policies
 *     (auth_user_can_access_in_space, auth_current_user_has_critical_capability,
 *     auth_user_is_org_admin, etc.) KEEP authenticated execute — revoking it would
 *     break policy evaluation (postgrest exposure of those is tracked separately;
 *     moving them to the private schema is a high-blast-radius follow-up).
 *   - the intended public rpcs (rpc_*, space_member_directory, auth_user_can_access_in_space,
 *     auth_user_has_permission, knowledge_user_scope_ids) KEEP authenticated execute by
 *     design and remain the accepted advisor residue.
 */

-- ---------------------------------------------------------------------------
-- 1) revoke execute from anon on every security definer function in public.
--    dynamic so it stays correct regardless of signature drift; no anon/public
--    rls policy references these functions (verified), so this is fail-closed
--    hardening with no behavior change.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from anon;', r.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) revoke select from anon on the advisor-flagged content/knowledge/admin
--    tables. every listed table has rls enabled with zero anon policies, so
--    anon already sees no rows; this removes the dormant grant (least privilege).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.oid::regclass as rel
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'select')
  loop
    execute format('revoke select on table %s from anon;', r.rel);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) revoke execute from authenticated on trigger-only and service-role-only
--    security definer functions. these are never called by the app via
--    postgrest (verified: 0 rls-policy references; absent from app rpc calls),
--    so authenticated reaching them via rest is the unintended default grant.
--    trigger functions execute as the table owner regardless of caller execute
--    privilege (verified empirically); service_role retains execute.
-- ---------------------------------------------------------------------------

-- trigger-only knowledge/content/identity guards and emitters
revoke execute on function public.assert_purge_not_in_use() from authenticated;
revoke execute on function public.assert_trash_change_authorized() from authenticated;
revoke execute on function public.assert_visibility_change_authorized() from authenticated;
revoke execute on function public.emit_access_change_audit() from authenticated;
revoke execute on function public.emit_knowledge_resource_purged_audit() from authenticated;
revoke execute on function public.handle_new_auth_user_profile() from authenticated;
revoke execute on function public.kb_cascade_trash_containment_orphans() from authenticated;
revoke execute on function public.outbox_jobs_delete_transport() from authenticated;
revoke execute on function public.outbox_jobs_enqueue_transport() from authenticated;
revoke execute on function public.profiles_prevent_super_admin_escalation() from authenticated;

-- service-role-only outbox / body-bridge transport (originally granted to
-- service_role; the app workers call these with the service role, never as an
-- authenticated rest caller)
revoke execute on function public.ensure_outbox_queue(text) from authenticated;
revoke execute on function public.rpc_enqueue_body_bridge_job(text, jsonb, text) from authenticated;
revoke execute on function public.rpc_enqueue_outbox_job(
  text, text, text, text, text, text, text, text, jsonb, text, integer, timestamptz
) from authenticated;
revoke execute on function public.rpc_outbox_claim_jobs(text, integer, text[]) from authenticated;
revoke execute on function public.rpc_outbox_complete_job(text, uuid) from authenticated;
revoke execute on function public.rpc_outbox_metrics(integer, integer) from authenticated;
revoke execute on function public.rpc_outbox_retry_job(text, uuid, text, integer, boolean) from authenticated;

-- service-role-only platform super-admin bootstrap / grant administration
revoke execute on function public.rpc_bootstrap_initial_platform_super_admin(uuid, text, text) from authenticated;
revoke execute on function public.rpc_service_role_grant_platform_super_admin(uuid, text) from authenticated;
revoke execute on function public.rpc_service_role_list_platform_super_admin_grants() from authenticated;

-- ---------------------------------------------------------------------------
-- accepted advisor residue (intended public rpcs, kept authenticated-executable
-- by design): documented so the close-out review does not "fix" them.
-- ---------------------------------------------------------------------------
comment on function public.rpc_resolve_platform_flag(text, text)
  is 'INTENDED PUBLIC RPC: app resolves entitlement/feature flags via postgrest under rls. authenticated-executable by design.';
comment on function public.space_member_directory(text, text, integer, text, uuid, uuid[])
  is 'INTENDED PUBLIC RPC: powers the co-member picker via postgrest under rls. authenticated-executable by design.';
comment on function public.rpc_bootstrap_organization_and_space(text, text, text, text, text)
  is 'INTENDED PUBLIC RPC: onboarding bootstrap called by the authenticated user. authenticated-executable by design.';
