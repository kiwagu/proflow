/*
 * purpose:
 *   a handful of security definer functions in public carry an explicit
 *   "grant execute ... to public" (acl entry "=X"), which makes them executable
 *   by BOTH anon and authenticated regardless of the role-specific revokes in
 *   20260627191100. this clears that residual public grant so the advisor's
 *   anon_/authenticated_security_definer_function_executable lints reach zero for
 *   these objects.
 *
 *   - the 6 trigger functions become service_role-only (triggers run as the table
 *     owner; callers need no execute privilege — verified empirically).
 *   - rpc_bootstrap_organization_and_space loses the public (anon) grant but keeps
 *     authenticated execute (intended onboarding rpc, called by the signed-in user).
 *
 * affected objects: execute privileges only.
 * special considerations: forward-only; idempotent revokes.
 */

-- trigger-only security definer functions: remove the public execute grant.
-- service_role retains execute; triggers fire as table owner regardless.
revoke execute on function public.emit_access_change_audit() from public;
revoke execute on function public.handle_new_auth_user_profile() from public;
revoke execute on function public.kb_cascade_trash_containment_orphans() from public;
revoke execute on function public.outbox_jobs_delete_transport() from public;
revoke execute on function public.outbox_jobs_enqueue_transport() from public;
revoke execute on function public.profiles_prevent_super_admin_escalation() from public;

-- onboarding rpc: drop the over-broad public (anon-reachable) grant; the signed-in
-- user still calls it via the authenticated grant below.
revoke execute on function public.rpc_bootstrap_organization_and_space(text, text, text, text, text) from public;
grant execute on function public.rpc_bootstrap_organization_and_space(text, text, text, text, text) to authenticated;
