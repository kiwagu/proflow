/*
 * purpose:
 *   the create-or-replace in 20260627191200 reapplied the public-schema default
 *   privileges (execute to anon + authenticated) to the
 *   public.kb_cascade_delete_containment_orphans trigger function. it is a
 *   trigger-only function (fires as the table owner; no caller needs execute), so
 *   the broad grant is unused. revoke it for least privilege, consistent with the
 *   other trigger functions hardened in 20260627191100 / 20260627191400.
 *
 * affected objects: execute privileges only on
 *   public.kb_cascade_delete_containment_orphans().
 * special considerations: forward-only; behavior unchanged (trigger still fires).
 */

revoke execute on function public.kb_cascade_delete_containment_orphans() from public;
revoke execute on function public.kb_cascade_delete_containment_orphans() from anon;
revoke execute on function public.kb_cascade_delete_containment_orphans() from authenticated;
