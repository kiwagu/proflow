/*
 * purpose:
 *   pin a stable search_path on public.kb_cascade_delete_containment_orphans to
 *   clear the supabase advisor function_search_path_mutable lint. the body is
 *   already fully schema-qualified (public.knowledge_resources / public.knowledge_edges),
 *   so behavior is identical; this only fixes the mutable search_path warning and
 *   matches its sibling kb_cascade_trash_containment_orphans (set search_path = public).
 *
 * affected objects: function public.kb_cascade_delete_containment_orphans()
 *   (containment-orphan cascade trigger on knowledge_resources delete).
 *
 * special considerations: forward-only recreate; identical body, adds the SET clause.
 */

create or replace function public.kb_cascade_delete_containment_orphans()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.knowledge_resources child
  where child.space_id = old.space_id
    and child.id in (
      select e.to_id
      from public.knowledge_edges e
      where e.from_id = old.id
        and e.relation_type = 'contains'
    )
    and not exists (
      select 1
      from public.knowledge_edges other_parent
      where other_parent.to_id = child.id
        and other_parent.relation_type = 'contains'
        and other_parent.from_id <> old.id
    );
  return old;
end;
$$;
