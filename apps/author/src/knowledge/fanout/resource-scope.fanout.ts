import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ScopeChoice } from '@/app/graph/graph-data.types';

/**
 * Resource visibility — cohort/scope sharing (UI-agnostic application module,
 * ADR-0005 §b). Linking a resource to a `scope` (cohort) fences it: a linked node
 * is visible only to that cohort's members; an unlinked node stays visible to all
 * space readers. NOT a graph edge — a separate access dimension
 * (`knowledge_resource_scopes`), never `knowledge_edges` (Invariant #1 unaffected).
 *
 * EVERY write runs under the user's RLS-scoped `db` — never service-role. RLS is
 * the SOLE authority: link/unlink gate on `space.knowledge.access` in the resource's
 * space; `linked_by` is pinned to the caller. The same-space guard (resource and
 * scope in one space) is enforced by a DB trigger.
 */

export type LinkResourceScopeInput = {
  resourceId: string; // knr_…
  scopeId: string; // scope (cohort) in the same space
};

/**
 * The space's cohort scopes + whether THIS node is fenced to each (read/query).
 * Two RLS-scoped selects: the space's scopes (cohorts the caller may read) and the
 * node's current `knowledge_resource_scopes` links (RLS mirrors node read). An
 * empty result = no cohorts defined → the node stays visible to all space readers.
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
 * Restrict a resource to a cohort scope (members-only-read). Idempotent against the
 * `(resource_id, scope_id)` PK — re-linking is a no-op (the fence already exists).
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
    // Duplicate (already fenced to this scope) → success no-op.
    if (error.code === '23505') {
      return { linked: false };
    }
    // RLS rejection (no space.knowledge.access) / same-space guard → clean failure.
    throw new Error(`linkResourceScope: ${error.message}`);
  }
  return { linked: true };
}

/**
 * Remove a resource↔scope fence (widen visibility). Returns how many rows the
 * caller's RLS context actually deleted (0 = nothing visible/permitted — a clean
 * no-op). A resource with zero scope links falls back to all-space-readers.
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
