-- Atomic, server-authoritative move of a knowledge resource.
--
-- Purpose
--   Until now a canonical re-parent reached the server as two independent
--   edge writes (delete the old `contains` edge, upsert the new one). The
--   only uniqueness the table knew was `(from_id, to_id, relation_type)`, so
--   two concurrent moves of one node could leave it with two canonical
--   parents, and a refused second half never rolled the first half back.
--
-- What changes
--   * `public.move_knowledge_resource(space, node, target_parent, position)`
--     performs detach + attach in ONE transaction, serialized per node with a
--     transaction-scoped advisory lock. A null target means "top level".
--   * A partial unique index over `knowledge_edges (to_id) where
--     relation_type = 'contains'` makes "at most one canonical parent" a
--     database fact rather than a client promise.
--   * The function runs as SECURITY INVOKER: RLS on `knowledge_edges` and the
--     existing acyclicity trigger stay the fences. It refuses explicitly
--     (42501) when the node or target is not visible in the given space, so a
--     replayed move against something the caller may not touch never turns
--     into a silent zero-row "success".
--
-- Data
--   The index cannot coexist with rows that already carry several `contains`
--   parents. This repository is pre-production and reset-mode: such rows are
--   removed here, keeping the oldest edge per child, and are not migrated.
--
-- Affected objects
--   public.knowledge_edges (data delete + new unique index)
--   public.move_knowledge_resource (new function)

-- ---------------------------------------------------------------------------
-- 1. one canonical parent per resource
-- ---------------------------------------------------------------------------

-- destructive: drops every `contains` edge except the oldest one per child.
-- only rows that violate the new invariant are touched.
delete from public.knowledge_edges e
using public.knowledge_edges keep
where e.relation_type = 'contains'
  and keep.relation_type = 'contains'
  and keep.to_id = e.to_id
  and (keep.created_at, keep.id) < (e.created_at, e.id);

create unique index knowledge_edges_single_canonical_parent
  on public.knowledge_edges (to_id)
  where relation_type = 'contains';

comment on index public.knowledge_edges_single_canonical_parent is
  'A resource has at most one incoming contains edge: the canonical parent. Shortcuts and associations are unaffected.';

-- ---------------------------------------------------------------------------
-- 2. the move itself
-- ---------------------------------------------------------------------------

create or replace function public.move_knowledge_resource(
  p_space_id text,
  p_node_id text,
  p_target_parent_id text,
  p_position integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Serialize moves of one node: two clients replaying against the same node
  -- take turns, and the later arrival is the one whose parent survives.
  perform pg_advisory_xact_lock(hashtext(p_node_id));

  -- Under RLS an invisible row simply is not there. Refuse explicitly rather
  -- than let the delete below match nothing and report success.
  if not exists (
    select 1
    from public.knowledge_resources r
    where r.id = p_node_id
      and r.space_id = p_space_id
  ) then
    raise exception 'move_knowledge_resource: node % is not accessible in space %',
      p_node_id, p_space_id
      using errcode = '42501';
  end if;

  if p_target_parent_id is not null and not exists (
    select 1
    from public.knowledge_resources r
    where r.id = p_target_parent_id
      and r.space_id = p_space_id
  ) then
    raise exception 'move_knowledge_resource: target % is not accessible in space %',
      p_target_parent_id, p_space_id
      using errcode = '42501';
  end if;

  -- Detach from every current container. The delete policy decides whether
  -- the caller may remove each edge; a policy refusal surfaces as an error
  -- from the insert path below being unreachable, never as a partial move.
  delete from public.knowledge_edges
  where to_id = p_node_id
    and relation_type = 'contains';

  if p_target_parent_id is not null then
    -- The acyclicity trigger fires here; its raise rolls the detach back too.
    insert into public.knowledge_edges
      (space_id, from_id, to_id, relation_type, position, created_by)
    values
      (p_space_id, p_target_parent_id, p_node_id, 'contains', p_position, (select auth.uid()));
  end if;
end;
$$;

comment on function public.move_knowledge_resource(text, text, text, integer) is
  'Atomic canonical re-parent: removes every incoming contains edge of the node and, for a non-null target, inserts the new one. Serialized per node; refuses (42501) when node or target is not visible in the space.';

revoke all on function public.move_knowledge_resource(text, text, text, integer) from public, anon;
grant execute on function public.move_knowledge_resource(text, text, text, integer) to authenticated;
