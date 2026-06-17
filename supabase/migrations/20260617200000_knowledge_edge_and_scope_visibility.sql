/*
 * knowledge graph — close two RLS read leaks on the access dimensions
 * (2026-06-17 review findings #2 and #3). Forward-only corrective migration:
 * the slice-07 access-dimensions migration (20260617190300) is already applied,
 * so this file re-creates the affected SELECT policies in place rather than
 * editing it.
 *
 * finding #2 — knowledge_edges leaks hidden-node metadata
 * - the edge SELECT policy (20260615190243) gates only on the edge's own
 *   `space_id` via space.knowledge.read. After slice-07 generalized NODE
 *   visibility into composable access dimensions (cohort + hierarchy), an edge
 *   touching a node the caller may NOT see stayed readable: the row reveals that
 *   hidden node's id (from_id/to_id), relation_type, metadata and its neighbours.
 * - fix: an edge is visible only when BOTH endpoints are access-visible to the
 *   caller, mirroring the node-level helper `auth_user_can_access_resource`. The
 *   edge's `space_id` already equals both endpoints' space (same-space guard), so
 *   the per-endpoint check uses the resource's own id/space_id/owner_user_id.
 *
 * finding #3 — knowledge_resource_scopes leaks the gating/cohort structure
 * - that link table's SELECT policy gates on base space.knowledge.read, so any
 *   reader with base read can ENUMERATE which resources are cohort-fenced (and to
 *   which scopes), even for resources the cohort hides from them.
 * - fix: align link-row visibility with access to the RESOURCE itself
 *   (`auth_user_can_access_resource(... 'space.knowledge.read')`). A caller who
 *   cannot see the resource cannot see that it is scope-fenced.
 *
 * scope of change: SELECT/visibility only. insert/update/delete policies and all
 * other knowledge_edges policies are untouched (authoring rights stay as today).
 * No core graph DDL — only policy bodies change.
 */

-- ---------------------------------------------------------------------------
-- finding #2 — knowledge_edges SELECT: both endpoints must be access-visible
-- ---------------------------------------------------------------------------

drop policy "knowledge_edges select for scoped readers" on public.knowledge_edges;

create policy "knowledge_edges select for scoped readers"
on public.knowledge_edges
for select
to authenticated
using (
  -- base space read on the edge's own space (unchanged floor) ...
  public.auth_user_can_access_in_space(
    knowledge_edges.space_id,
    'space.knowledge.read'
  )
  -- ... AND the from-endpoint resource is access-visible (cohort + hierarchy) ...
  and exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_edges.from_id
      and public.auth_user_can_access_resource(
        r.id,
        r.space_id,
        r.owner_user_id,
        'space.knowledge.read'
      )
  )
  -- ... AND the to-endpoint resource is access-visible too. An edge that touches
  -- a node the caller cannot see is itself hidden (no metadata/neighbour leak).
  and exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_edges.to_id
      and public.auth_user_can_access_resource(
        r.id,
        r.space_id,
        r.owner_user_id,
        'space.knowledge.read'
      )
  )
);

-- ---------------------------------------------------------------------------
-- finding #3 — knowledge_resource_scopes SELECT: gate on resource access, not
-- base read, so the cohort-fencing of a hidden resource cannot be enumerated.
-- ---------------------------------------------------------------------------

drop policy "knowledge_resource_scopes select for scoped readers"
  on public.knowledge_resource_scopes;

create policy "knowledge_resource_scopes select for scoped readers"
on public.knowledge_resource_scopes
for select
to authenticated
using (
  exists (
    select 1
    from public.knowledge_resources r
    where r.id = knowledge_resource_scopes.resource_id
      and public.auth_user_can_access_resource(
        r.id,
        r.space_id,
        r.owner_user_id,
        'space.knowledge.read'
      )
  )
);
