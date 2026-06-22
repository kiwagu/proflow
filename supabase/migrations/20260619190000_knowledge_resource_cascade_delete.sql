/*
 * knowledge graph — containment-orphan cascade delete (DB-enforced)
 *
 * Deleting a knowledge_resource must also delete its `contains` children that
 * become ORPHANS — i.e. have no OTHER containment parent than the row being
 * deleted. A child still contained by another folder SURVIVES (many-to-one
 * containment): only the edge from the deleted ancestor goes (FK on delete cascade
 * on knowledge_edges). The selected node itself is always deleted.
 *
 * This rule lives in the DATABASE (a trigger), not the app layer, so it holds for
 * EVERY caller — the Next route today, and a future REST/MCP API hitting the table
 * directly. The app just issues a plain `delete` of the target; the cascade follows.
 *
 * RLS stays the authority: the trigger function is SECURITY INVOKER (default), so
 * each cascaded delete runs as the calling user and is gated by the
 * `space.knowledge.delete` policy exactly like the top-level delete — the trigger
 * can only remove rows the caller could already remove.
 *
 * Recursion: deleting an orphaned child re-fires this BEFORE-DELETE trigger, so the
 * cascade walks the whole orphaned sub-forest. The `contains` forest is acyclic by
 * construction; a malformed cycle is bounded by Postgres's trigger-depth limit
 * (errors out, never loops forever).
 */

create or replace function public.kb_cascade_delete_containment_orphans()
returns trigger
language plpgsql
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

comment on function public.kb_cascade_delete_containment_orphans() is
  'BEFORE DELETE on knowledge_resources: recursively delete contains-children that lose their last containment parent (orphans); many-to-one children survive. DB-enforced so REST/MCP/any caller gets the same rule. Security invoker — RLS (space.knowledge.delete) governs every cascaded row.';

drop trigger if exists knowledge_resources_cascade_orphans
  on public.knowledge_resources;

create trigger knowledge_resources_cascade_orphans
before delete on public.knowledge_resources
for each row
execute function public.kb_cascade_delete_containment_orphans();
