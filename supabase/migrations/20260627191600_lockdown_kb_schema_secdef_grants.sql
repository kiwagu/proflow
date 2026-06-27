/*
 * purpose:
 *   the kb schema is exposed via postgrest (PGRST_DB_SCHEMAS=public,storage,kb),
 *   so the supabase advisor also evaluates its security definer functions for the
 *   anon_/authenticated_security_definer_function_executable lints. all five kb
 *   functions are TRIGGER functions (return trigger) — append_activity_from_origin
 *   and rollup_resource_activity are security definer; the rest are guards. none
 *   are called by the app as rpcs (the app only does kb table i/o via .schema('kb')).
 *
 *   trigger functions fire as the table owner, so callers need no execute
 *   privilege. revoke execute from anon + authenticated (the unused default
 *   schema grant) so these stop appearing in the advisor.
 *
 * affected objects: execute privileges only on the kb trigger functions; kb
 *   schema usage and kb table privileges are untouched (app table i/o unaffected).
 * special considerations: forward-only; idempotent; behavior unchanged.
 */

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kb'
      and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public;', r.sig);
    execute format('revoke execute on function %s from anon;', r.sig);
    execute format('revoke execute on function %s from authenticated;', r.sig);
  end loop;
end;
$$;
