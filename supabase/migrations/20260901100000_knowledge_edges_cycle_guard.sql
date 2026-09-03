-- Containment acyclicity, enforced server-side.
--
-- Until now the only thing stopping a folder being dropped inside its own
-- subtree was a guard in the client. That was sufficient while every
-- structural write arrived through the app's own UI, and it stops being
-- sufficient the moment writes can be composed offline and replayed later:
-- a replayed move never passes through the client guard, so the invariant
-- has to live where the row lands.
--
-- Scope is deliberately narrow. Only `contains` is a containment relation —
-- `shortcut` is a cross-folder symlink that is rendered but never traversed,
-- and `tagged`/`relates_to` are associations where a cycle means nothing. A
-- guard over every relation would refuse legitimate graphs.
--
-- Cost: one upward walk per contains-edge write, bounded by the depth of the
-- tree above the new parent (folder hierarchies are shallow), over the
-- existing `(to_id, relation_type)` index. Writes to other relations pay a
-- single comparison and return.

create or replace function public.assert_knowledge_edge_acyclic()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cyclic boolean;
begin
  if new.relation_type <> 'contains' then
    return new;
  end if;

  -- A self-edge is already refused by the table's own check constraint; this
  -- catches the indirect case: is the proposed child already an ancestor of
  -- the proposed parent?
  with recursive up as (
    select new.from_id as id, array[new.from_id] as seen
    union all
    select e.from_id, up.seen || e.from_id
      from public.knowledge_edges e
      join up on e.to_id = up.id
     where e.relation_type = 'contains'
       -- Guards the walk itself: a cycle that predates this trigger (or one
       -- introduced by a direct database write) must not spin forever.
       and not e.from_id = any (up.seen)
  )
  select exists (select 1 from up where id = new.to_id) into v_cyclic;

  if v_cyclic then
    raise exception 'knowledge_edges: containment cycle — % cannot contain %',
      new.from_id, new.to_id;
  end if;

  return new;
end;
$$;

create trigger knowledge_edges_acyclic_guard
before insert or update on public.knowledge_edges
for each row
execute function public.assert_knowledge_edge_acyclic();
