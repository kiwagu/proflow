/*
 * document body writes follow the owning resource's own update rule.
 *
 * the body fence says that editing a body is the resource row's update rule:
 * the resource's owner, or the space update verb on a readable resource. its
 * write branch checked the verb only, so a member who was handed ownership of
 * a node could edit the node but not its body. this replaces the predicate
 * with the owner clause added; nothing else changes (the read branch, the
 * creator disjunct, the mutual link and the registration rule stay as they
 * are), and the satellite policies and the compaction rpc pick it up through
 * the by-id wrapper unchanged.
 */

create or replace function private.auth_user_can_access_document_row(
  p_doc_id text,
  p_space_id text,
  p_created_by uuid,
  p_resource_id text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when p_action not in ('read', 'update') then false
      else
        public.auth_user_can_access_in_space(p_space_id, 'space.documents.' || p_action)
        and (
          p_created_by = (select auth.uid())
          or exists (
            select 1
            from public.knowledge_resources r
            where r.id = p_resource_id
              and r.body_ref ->> 'doc_id' = p_doc_id
              and r.space_id = p_space_id
              and private.auth_user_can_access_resource(
                    r.id, r.space_id, r.owner_user_id, r.visibility,
                    'space.knowledge.read')
              and (
                p_action = 'read'
                or r.owner_user_id = (select auth.uid())
                or public.auth_user_can_access_in_space(r.space_id, 'space.knowledge.update')
              )
          )
        )
    end;
$$;

comment on function private.auth_user_can_access_document_row(text, text, uuid, text, text) is
  'The body fence on a document row''s own columns, so it also holds for a row being inserted: the creator, or the resource that owns the body (named by the document, pointing back) under the resource''s own read predicate; editing additionally needs the resource''s own update rule, its owner or the space update verb.';

revoke all on function private.auth_user_can_access_document_row(text, text, uuid, text, text) from public;
revoke all on function private.auth_user_can_access_document_row(text, text, uuid, text, text) from anon;
grant execute on function private.auth_user_can_access_document_row(text, text, uuid, text, text) to authenticated;
