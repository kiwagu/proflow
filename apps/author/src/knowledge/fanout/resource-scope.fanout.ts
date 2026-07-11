import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ResourceFloor, ScopeChoice } from '@/app/graph/graph-data.types';

/**
 * Resource visibility — broadcast floor + cohort grants (UI-agnostic application
 * module). Visibility composes as ONE broadcast floor
 * (the `knowledge_resources.visibility` column: private / space / organization) plus
 * additive cohort GRANTS. Linking a resource to a `scope` (cohort) is an ADDITIVE
 * grant — it WIDENS access to that cohort's members; it never fences. On a `space`
 * floor the node is already broadcast to all, so a cohort grant is redundant; to
 * share with a cohort ONLY, set the floor to `private` and grant the cohort. Cohorts
 * are NOT graph edges — a separate access dimension (`knowledge_resource_scopes`),
 * never `knowledge_edges` (Invariant #1 unaffected).
 *
 * EVERY write runs under the user's RLS-scoped `db` — never service-role. RLS is the
 * SOLE authority: cohort link/unlink gate on `space.knowledge.access`; the floor
 * change is owner-sovereign (D9 trigger: owner OR `space.knowledge.access`).
 * `linked_by` is pinned to the caller. The same-space guard (resource and scope in
 * one space) is enforced by a DB trigger.
 */

/** Read this node's current broadcast floor (owner/access-visible under RLS). */
export async function loadResourceFloor(
  input: { nodeId: string },
  deps: { db: SupabaseClient<Database> }
): Promise<ResourceFloor | null> {
  const { db } = deps;
  const { data, error } = await db
    .from('knowledge_resources')
    .select('visibility')
    .eq('id', input.nodeId)
    .maybeSingle();
  if (error) {
    throw new Error(`loadResourceFloor: ${error.message}`);
  }
  return (data as { visibility: ResourceFloor } | null)?.visibility ?? null;
}

/**
 * Set this node's broadcast floor (publish private→space, or restrict space→private).
 * Owner-sovereign (D9): the BEFORE-UPDATE guard trigger allows the change only for the
 * owner or a space access-manager — an RLS/trigger rejection surfaces as a clean error.
 * No RETURNING (a node just made `private` by a non-owner admin would not read back
 * under the Model B SELECT policy); the caller already knows the target value.
 */
export async function setResourceFloor(
  input: { resourceId: string; visibility: ResourceFloor },
  deps: { db: SupabaseClient<Database> }
): Promise<{ visibility: ResourceFloor }> {
  const { db } = deps;
  const { error } = await db
    .from('knowledge_resources')
    .update({ visibility: input.visibility })
    .eq('id', input.resourceId);
  if (error) {
    throw new Error(`setResourceFloor: ${error.message}`);
  }
  return { visibility: input.visibility };
}

export type LinkResourceScopeInput = {
  resourceId: string; // knr_…
  scopeId: string; // scope (cohort) in the same space
};

/**
 * The space's cohort scopes + whether THIS node is GRANTED to each (read/query).
 * Two RLS-scoped selects: the space's scopes (cohorts the caller may read) and the
 * node's current `knowledge_resource_scopes` links (RLS mirrors node read). An empty
 * result = no cohorts defined → the node's audience is its floor + owner only.
 */
export async function listScopeChoices(
  input: { spaceId: string; nodeId: string },
  deps: { db: SupabaseClient<Database> }
): Promise<ScopeChoice[]> {
  const { db } = deps;
  const [scopesResult, linksResult] = await Promise.all([
    db
      .from('scopes')
      .select('id,name')
      .eq('space_id', input.spaceId)
      .order('name', { ascending: true }),
    db
      .from('knowledge_resource_scopes')
      .select('scope_id')
      .eq('resource_id', input.nodeId),
  ]);
  if (scopesResult.error) {
    throw new Error(`listScopeChoices scopes: ${scopesResult.error.message}`);
  }
  if (linksResult.error) {
    throw new Error(`listScopeChoices links: ${linksResult.error.message}`);
  }
  const linked = new Set(
    (linksResult.data ?? []).map(
      (row) => (row as { scope_id: string }).scope_id
    )
  );
  return (scopesResult.data ?? []).map((row) => {
    const scope = row as { id: string; name: string };
    return { id: scope.id, name: scope.name, linked: linked.has(scope.id) };
  });
}

/**
 * GRANT a cohort access to a resource (additive — widens to the cohort's members).
 * Idempotent against the `(resource_id, scope_id)` PK — re-linking
 * is a no-op (the grant already exists).
 */
export async function linkResourceScope(
  input: LinkResourceScopeInput,
  deps: { db: SupabaseClient<Database>; userId: string }
): Promise<{ linked: boolean }> {
  const { db, userId } = deps;
  const { error } = await db.from('knowledge_resource_scopes').insert({
    resource_id: input.resourceId,
    scope_id: input.scopeId,
    linked_by: userId,
  });
  if (error) {
    // Duplicate (already granted to this cohort) → success no-op.
    if (error.code === '23505') {
      return { linked: false };
    }
    // RLS rejection (no space.knowledge.access) / same-space guard → clean failure.
    throw new Error(`linkResourceScope: ${error.message}`);
  }
  return { linked: true };
}

/**
 * Remove a cohort grant (narrow — the cohort loses access). Returns
 * how many rows the caller's RLS context actually deleted (0 = nothing visible/
 * permitted — a clean no-op). A resource with zero grants falls back to its floor +
 * owner.
 */
export async function unlinkResourceScope(
  input: LinkResourceScopeInput,
  deps: { db: SupabaseClient<Database> }
): Promise<{ deleted: number }> {
  const { db } = deps;
  const { data, error } = await db
    .from('knowledge_resource_scopes')
    .delete()
    .eq('resource_id', input.resourceId)
    .eq('scope_id', input.scopeId)
    .select('resource_id');
  if (error) {
    throw new Error(`unlinkResourceScope: ${error.message}`);
  }
  return { deleted: data?.length ?? 0 };
}
