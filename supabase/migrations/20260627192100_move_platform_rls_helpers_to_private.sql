/*
 * purpose:
 *   wave 2 of the secdef-helper relocation (see 20260627192000 for the knowledge wave).
 *   move the platform RBAC / runtime-settings / feature-flag RLS-INTERNAL security-definer
 *   helpers OUT of the PostgREST-exposed `public` schema into the non-exposed `private`
 *   schema, clearing the advisor `authenticated_security_definer_function_executable` (0029)
 *   for them while keeping RLS evaluation working (authenticated retains EXECUTE, now only
 *   reachable inside RLS / security-definer call chains, never via /rest/v1/rpc).
 *
 * what moves (9 — referenced ONLY by RLS policies and by other functions; NEVER called by
 * the app via PostgREST — verified against every app `.rpc(...)` call):
 *   auth_user_active_in_space(text,uuid), auth_user_is_org_admin(text,uuid),
 *   auth_user_is_space_admin(text,uuid), auth_user_member_of_org(text,uuid),
 *   role_assignment_is_valid(text,text,text), auth_user_can_manage_space_invites(text,uuid),
 *   runtime_settings_actor_can_read_scope(text,text,boolean),
 *   runtime_settings_actor_can_manage_scope(text,text),
 *   platform_feature_flag_actor_can_manage_scope(text,text)
 *
 * what STAYS in public (app calls them by name via PostgREST, or are dual-use): all rpc_*,
 *   auth_user_can_access_in_space, auth_user_has_permission, auth_(current_)user_has_critical_capability,
 *   space_member_directory, knowledge_user_scope_ids (accepted advisor residue, out of scope).
 *
 * mechanics:
 *   - `alter function ... set schema private` preserves the OID, so every RLS policy that
 *     references a moved helper (e.g. by `auth_user_is_org_admin`) follows the move with NO
 *     policy edit (proven in the knowledge wave).
 *   - the helpers (and their callers — moved AND staying, e.g. auth_user_can_access_in_space,
 *     space_member_directory, rpc_create_space_invite, rpc_*runtime_setting,
 *     rpc_set_platform_feature_flag, even trigger fns) qualify their calls as `public.<helper>`,
 *     which no longer resolves after the move. Rather than hand-transcribe ~600 lines of
 *     plpgsql (error-prone), the DO block below re-points EVERY caller deterministically from
 *     its LIVE definition: it finds every public/private function whose body references
 *     `public.<moved>(`, replaces only those refs with `private.<moved>(`, and `create or
 *     replace`s it (OID preserved). This is comprehensive (catches callers beyond the manual
 *     analysis) and transcription-free. The `(` boundary distinguishes function calls from
 *     same-named tables; none of the nine names is a prefix of another.
 *
 * special considerations:
 *   - reset-mode forward-only; this is the LAST migration to touch these functions, so a
 *     fresh `db reset` lands them in `private` with corrected references.
 *   - `private` is NOT in PGRST_DB_SCHEMAS (public,storage,kb) → nothing here is REST-reachable.
 *   - verified by the platform RPC integration tests + full e2e (RBAC, invites, runtime
 *     settings, feature flags) after apply.
 */

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- 1) relocate the nine helpers (OID preserved → policies follow automatically).
alter function public.auth_user_active_in_space(text, uuid) set schema private;
alter function public.auth_user_is_org_admin(text, uuid) set schema private;
alter function public.auth_user_is_space_admin(text, uuid) set schema private;
alter function public.auth_user_member_of_org(text, uuid) set schema private;
alter function public.role_assignment_is_valid(text, text, text) set schema private;
alter function public.auth_user_can_manage_space_invites(text, uuid) set schema private;
alter function public.runtime_settings_actor_can_read_scope(text, text, boolean) set schema private;
alter function public.runtime_settings_actor_can_manage_scope(text, text) set schema private;
alter function public.platform_feature_flag_actor_can_manage_scope(text, text) set schema private;

-- 2) re-point every caller `public.<moved>(` -> `private.<moved>(`, from the live definition.
do $migrate$
declare
  v_targets text[] := array[
    'auth_user_active_in_space', 'auth_user_is_org_admin', 'auth_user_is_space_admin',
    'auth_user_member_of_org', 'role_assignment_is_valid', 'auth_user_can_manage_space_invites',
    'runtime_settings_actor_can_read_scope', 'runtime_settings_actor_can_manage_scope',
    'platform_feature_flag_actor_can_manage_scope'
  ];
  v_oid oid;
  v_def text;
  v_name text;
begin
  for v_oid in
    select p.oid
    from pg_proc p
    where p.prokind = 'f'
      and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and exists (
        select 1 from unnest(v_targets) t
        where pg_get_functiondef(p.oid) like '%public.' || t || '(%'
      )
  loop
    v_def := pg_get_functiondef(v_oid);
    foreach v_name in array v_targets loop
      v_def := replace(v_def, 'public.' || v_name || '(', 'private.' || v_name || '(');
    end loop;
    execute v_def;
  end loop;
end
$migrate$;
