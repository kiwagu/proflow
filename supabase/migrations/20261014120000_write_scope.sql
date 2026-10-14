/*
 * the write scope: what one person may change in one space, per action of
 * the workbench, derived from the same role verbs the write policies use.
 *
 * why
 *   the workbench should not offer what the server will refuse: a member
 *   who opens a document they may read but not edit should get a read-only
 *   pane, not a pane whose every keystroke is refused later. every write
 *   policy on the replicated tables has the shape "my row, or a space verb",
 *   so the client needs one fact per action: which side of that "or" the
 *   person is on. this function states it, and only it: no grant, audience
 *   or role structure leaves the server, and the policies stay the fence. a
 *   wrong or stale answer ends in the same refusal a write gets without it.
 *
 * the answer
 *   a jsonb object, one key per action, each one of:
 *     "all"            any row the person can see
 *     {"own": [cols]}  rows where one of the named columns is the person;
 *                      the names are the row's own server columns, plus
 *                      parent_edge_created_by for the creator of the
 *                      containment edge that places a node
 *     "none"           nothing
 *   actions and the rules they mirror:
 *     node.create  node and edge inserts: the create verb
 *     node.update  node update: owner, or the update verb
 *     node.move    the move rpc removes the current containment edge (its
 *                  creator, or the delete verb) and inserts one (the create
 *                  verb)
 *     node.trash   trash and restore: the update rule and the trash guard
 *                  (owner, or the delete verb)
 *     node.purge   node delete: owner, or the delete verb. the in-use guard
 *                  also refuses an owner without the verb whose node another
 *                  owner's folder still holds; that per-row condition is
 *                  left to the server's refusal
 *     node.star    own per-user state: the progress verb
 *     body.write   a body's update log: the documents update verb, and the
 *                  node's update rule (owner, or the update verb); the
 *                  body's own creator may also write it, which the client
 *                  does not hold and so does not count on
 *   someone who cannot read the space gets "none" everywhere.
 *
 * kept honest by supabase/tests/write_scope_mirror.sql, which tries every
 * action as every system role on a row of their own and on someone else's,
 * and compares the outcome with this answer.
 */

create or replace function public.rpc_my_write_scope(p_space_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with verbs as (
    select
      public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.read') as k_read,
      public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.create') as k_create,
      public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.update') as k_update,
      public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.delete') as k_delete,
      public.auth_user_can_access_in_space(p_space_id, 'space.knowledge.progress') as k_progress,
      public.auth_user_can_access_in_space(p_space_id, 'space.documents.update') as d_update
  ),
  verdicts as (
    select
      to_jsonb('all'::text) as v_all,
      to_jsonb('none'::text) as v_none,
      jsonb_build_object('own', jsonb_build_array('owner_user_id')) as v_own_node,
      jsonb_build_object('own', jsonb_build_array('parent_edge_created_by')) as v_own_edge
  )
  select case
    when not k_read then jsonb_build_object(
      'node.create', v_none, 'node.update', v_none, 'node.move', v_none,
      'node.trash', v_none, 'node.purge', v_none, 'node.star', v_none,
      'body.write', v_none)
    else jsonb_build_object(
      'node.create', case when k_create then v_all else v_none end,
      'node.update', case when k_update then v_all else v_own_node end,
      'node.move', case
        when not k_create then v_none
        when k_delete then v_all
        else v_own_edge end,
      'node.trash', case when k_update and k_delete then v_all else v_own_node end,
      'node.purge', case when k_delete then v_all else v_own_node end,
      'node.star', case when k_progress then v_all else v_none end,
      'body.write', case
        when not d_update then v_none
        when k_update then v_all
        else v_own_node end)
  end
  from verbs, verdicts;
$$;

comment on function public.rpc_my_write_scope(text) is
  'What the calling person may change in the space, per workbench action: "all", {"own": [columns]} or "none", derived from the role verbs the write policies use. A hint for the interface; the policies stay the fence.';

revoke all on function public.rpc_my_write_scope(text) from public;
revoke all on function public.rpc_my_write_scope(text) from anon;
grant execute on function public.rpc_my_write_scope(text) to authenticated;
