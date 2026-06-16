/*
 * knowledge graph — projection resolve transport (see docs/knowledge-graph-plan.md §4).
 *
 * purpose
 * - the projection-execution engine compiles a saved ProjectionSpec into ONE
 *   parameterized, recursive-CTE SELECT in TypeScript (@workspace/knowledge-engine).
 *   supabase-js cannot run arbitrary text SQL under a user JWT, so this narrow
 *   RPC executes that compiled SQL on the caller's behalf.
 *
 * rls safety (the whole point)
 * - SECURITY INVOKER: the dynamic query runs as the CALLING user, so RLS on
 *   knowledge_resources / knowledge_edges applies natively. The engine can only
 *   NARROW what RLS already allows; it physically cannot widen access. A
 *   SECURITY DEFINER variant is deliberately NOT used (it would bypass RLS).
 * - the only SQL ever passed here is produced by the engine's compiler, whose
 *   field/operator allow-list is the single source of truth and whose VALUES are
 *   carried as the bound jsonb param, never interpolated. As defence in depth the
 *   function rejects any statement that is not a `with recursive ... select`.
 *
 * note: this is transport plumbing, NOT core graph DDL — no new column, table, or
 * ALTER on the node/edge tables (Variant B keeps the graph schema untouched).
 */

create or replace function public.resolve_projection_query(
  p_sql text,
  p_params jsonb
)
returns table (
  id text,
  kind text,
  title text,
  status text,
  visibility text,
  body_ref jsonb,
  depth integer,
  via_edge_id text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_normalized text := lower(ltrim(p_sql));
begin
  -- defence in depth: only the engine's compiled resolve shape is accepted.
  if v_normalized not like 'with recursive%' then
    raise exception 'resolve_projection_query: only a compiled projection resolve query is allowed';
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'array' then
    raise exception 'resolve_projection_query: p_params must be a jsonb array';
  end if;

  -- p_sql references its values exclusively through the single bound jsonb param.
  return query execute p_sql using p_params;
end;
$$;

comment on function public.resolve_projection_query(text, jsonb) is
  'SECURITY INVOKER transport for the projection engine: executes the TS-compiled, parameterized resolve query under the caller''s RLS session. Values travel in the bound jsonb param, never interpolated.';

revoke all on function public.resolve_projection_query(text, jsonb) from public;
grant execute on function public.resolve_projection_query(text, jsonb) to authenticated;
