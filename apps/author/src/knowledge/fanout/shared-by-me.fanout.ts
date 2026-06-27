import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { byText } from '@workspace/ui/lib/sort';

import type {
  ShareAudience,
  SharedByMeEntry,
} from '@/app/graph/graph-data.types';

/**
 * "Shared by me" lens (ADR-0021 Part B, extended for cohort-by-me per ADR-0023 §7) — a
 * READ-ONLY projection over the OUTBOUND grants the CURRENT user created, across BOTH
 * additive dimensions: per-user (`knowledge_resource_user_grants`, ADR-0019) AND cohort
 * (`knowledge_resource_scopes`, ADR-0017). NO new table, NO resolver change, NO new
 * access dimension — both tables + the co-member directory (ADR-0020) and the scope
 * names already landed. Invariant #1 holds: this is the OPPOSITE direction of the same
 * grant graph the "Shared with me" lens reads.
 *
 * EVERY read runs under the user's RLS-scoped `db` — NEVER service-role. RLS is the
 * SOLE authority and the fence is fail-closed by construction:
 *   - `granted_by = (select auth.uid())` / `linked_by = (select auth.uid())` are FILTERS
 *     (which grants I created), not the fence — both are pinned to the session at insert
 *     (`granted_by`: ADR-0019; `linked_by`: the resource-scope fanout), so neither can be
 *     forged. The cohort filter MIRRORS the per-user `granted_by = me` filter EXACTLY.
 *   - the grant/scope SELECT RLS (any space reader sees the rows of their space) + the
 *     `knowledge_resources` SELECT RLS (node read) are the fence: the resources are
 *     re-joined under RLS, so a resource I once granted but can NO LONGER see (moved,
 *     lost access, trashed-out-of-view) drops out — it never appears.
 *
 * Grantee labels: `profiles` is OWN-ROW-only under RLS, so other members are labelled via
 * the `space_member_directory` SECURITY-DEFINER RPC (gated by the caller's own active
 * membership of the space — non-member → ∅, zero service-role); cohorts are labelled by
 * the `scopes.name` of the cohorts I linked (read under the caller's RLS). The two audience
 * dimensions are merged into one `grantees` list, each entry tagged with its `kind`.
 */

/** The directory RPC hard cap (`least(…, 50)`); the limit used to resolve grantee labels. */
const DIRECTORY_LIMIT = 50;

type DirectoryLabel = { displayName: string | null; email: string | null };

/** Resolve a display label for a grantee from the directory fields. */
function memberLabel(input: {
  userId: string;
  displayName: string | null;
  email: string | null;
}): string {
  return (
    input.displayName?.trim() || input.email?.trim() || input.userId.slice(0, 8)
  );
}

/**
 * The co-member directory for a space keyed by user_id (ADR-0020). One RLS-respecting
 * RPC call: the SECURITY-DEFINER function returns co-member `display_name` + `email`
 * ONLY when the caller is an active member of the space (else ∅). One bounded fetch
 * resolves the grantee set for the whole lens (the grantees are co-members, ≤ the cap).
 */
async function loadDirectoryLabels(
  spaceId: string,
  deps: { db: SupabaseClient<Database> }
): Promise<Map<string, DirectoryLabel>> {
  const labels = new Map<string, DirectoryLabel>();
  const { data, error } = await deps.db.rpc('space_member_directory', {
    p_space_id: spaceId,
    p_limit: DIRECTORY_LIMIT,
  });
  if (error) {
    throw new Error(`shared-by-me directory: ${error.message}`);
  }
  for (const row of data ?? []) {
    labels.set(row.user_id, {
      displayName: row.display_name,
      email: row.email,
    });
  }
  return labels;
}

/** Chunk size for `.in('id', …)` selects — keeps each PostgREST GET URL under the
 * Supabase REST gateway (Kong/nginx) ~4 KB limit (parity with the graph page load's
 * `inChunks`; a large id set otherwise 502s). */
const IN_CHUNK_SIZE = 50;

/**
 * The cohort (scope) names for a space, keyed by `scope_id` — read under the caller's
 * RLS over `scopes` (the same read the share dialog's cohort picker uses). One bounded
 * fetch labels every cohort grant in the lens. A scope the caller cannot read simply
 * does not return; its id falls back to a short slug label (parity with `memberLabel`).
 */
async function loadScopeNames(
  spaceId: string,
  deps: { db: SupabaseClient<Database> }
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data, error } = await deps.db
    .from('scopes')
    .select('id,name')
    .eq('space_id', spaceId);
  if (error) {
    throw new Error(`shared-by-me scopes: ${error.message}`);
  }
  for (const row of data ?? []) {
    const scope = row as { id: string; name: string };
    names.set(scope.id, scope.name);
  }
  return names;
}

/**
 * The subset of `resourceIds` that are VISIBLE + LIVE to the caller in `spaceId`, read
 * under the user's RLS — the fail-closed fence for the lens. Each resource is re-read
 * through the `knowledge_resources` SELECT RLS (the per-node visibility predicate), so a
 * resource the caller can no longer see, or one in another space, or a trashed one
 * (`deleted_at IS NOT NULL`) does not return. Chunked to stay under the gateway URL cap.
 */
async function loadVisibleResourceIds(
  spaceId: string,
  resourceIds: string[],
  deps: { db: SupabaseClient<Database> }
): Promise<Set<string>> {
  const visible = new Set<string>();
  if (resourceIds.length === 0) {
    return visible;
  }
  const { db } = deps;
  for (let i = 0; i < resourceIds.length; i += IN_CHUNK_SIZE) {
    const chunk = resourceIds.slice(i, i + IN_CHUNK_SIZE);
    const { data, error } = await db
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', spaceId)
      .in('id', chunk)
      .is('deleted_at', null);
    if (error) {
      throw new Error(`listResourcesSharedByMe visible: ${error.message}`);
    }
    for (const row of data ?? []) {
      visible.add((row as { id: string }).id);
    }
  }
  return visible;
}

/**
 * The resources the CURRENT user has shared OUT in a space, each with the AUDIENCE
 * (per-user grantees + cohorts) they granted it to (ADR-0021 Part B, extended for
 * cohort-by-me per ADR-0023 §7). All reads RLS-scoped — never service-role.
 *
 * Mechanism (read-only over landed tables):
 *   1. Per-user grants where `granted_by = me`, AND cohort links where `linked_by = me`
 *      — the outbound grants I created across BOTH dimensions. The grant/scope SELECT RLS
 *      already scopes the read to my space's rows (gated on the resource's space read);
 *      `granted_by`/`linked_by = me` filter to MINE (the cohort filter MIRRORS the
 *      per-user one). Neither alone is the visibility fence (space-read ≠ node-read).
 *   2. Re-join `knowledge_resources` UNDER RLS to drop any grant whose resource I can no
 *      longer SEE (the node SELECT RLS is the fence — fail-closed). A grant pointing at a
 *      resource hidden from me (or in another space) yields no row → it vanishes. The
 *      fence covers the UNION of per-user + cohort granted resource ids.
 *   3. Resolve labels once: co-member names via the directory (per-user), scope names
 *      (cohort), both bounded RLS fetches.
 *
 * Grouped by resource (one entry per resource, N audience entries each tagged with its
 * `kind`), the audience sorted by display name via the canonical text sorter
 * (`@workspace/ui/lib/sort` → `@workspace/std`). Empty when I have shared nothing
 * visible — never an error.
 */
export async function listResourcesSharedByMe(
  input: { spaceId: string },
  deps: { db: SupabaseClient<Database> }
): Promise<SharedByMeEntry[]> {
  const { db } = deps;

  // The CURRENT user (the granter). A guest has no grants → empty lens.
  const { data: auth } = await db.auth.getUser();
  const me = auth.user?.id;
  if (!me) {
    return [];
  }

  // The per-user grants I CREATED — the grant SELECT RLS already scopes the read to MY
  // space's grant rows (it gates on the resource's `space.knowledge.read`); `granted_by =
  // me` narrows to mine. NOT the visibility fence (space-read ≠ node-read): the fence is
  // the node re-read (step 2), fail-closed.
  const { data: grantRows, error: grantsErr } = await db
    .from('knowledge_resource_user_grants')
    .select('resource_id,user_id')
    .eq('granted_by', me);
  if (grantsErr) {
    throw new Error(`listResourcesSharedByMe grants: ${grantsErr.message}`);
  }
  const userRows = (grantRows ?? []).map(
    (row) => row as { resource_id: string; user_id: string }
  );

  // The cohort links I CREATED — the EXACT cohort twin of the per-user read (ADR-0023
  // §7). The scope SELECT RLS scopes the read to my space's link rows; `linked_by = me`
  // filters to the cohort grants I authored (`linked_by` is pinned to the session at
  // insert, so it cannot be forged — a FILTER, never the fence). The node re-read (step
  // 2) is the fail-closed visibility fence, identical to the per-user path.
  const { data: scopeRows, error: scopesErr } = await db
    .from('knowledge_resource_scopes')
    .select('resource_id,scope_id')
    .eq('linked_by', me);
  if (scopesErr) {
    throw new Error(`listResourcesSharedByMe cohort: ${scopesErr.message}`);
  }
  const cohortRows = (scopeRows ?? []).map(
    (row) => row as { resource_id: string; scope_id: string }
  );

  if (userRows.length === 0 && cohortRows.length === 0) {
    return [];
  }

  // The FENCE (fail-closed): re-read the granted resources UNDER the node SELECT RLS,
  // narrowed to THIS space + LIVE (deleted_at IS NULL — a trashed resource leaves the
  // live lens). A resource the per-node RLS hides — or one in another space — simply
  // does not return here, so it is dropped below. Covers the UNION of both dimensions.
  // Chunked to keep each `.in('id', …)` request URL under the REST gateway limit.
  const grantedResourceIds = Array.from(
    new Set([
      ...userRows.map((r) => r.resource_id),
      ...cohortRows.map((r) => r.resource_id),
    ])
  );
  const visibleIds = await loadVisibleResourceIds(
    input.spaceId,
    grantedResourceIds,
    { db }
  );
  if (visibleIds.size === 0) {
    return [];
  }

  // Resolve labels once for the whole lens (bounded RLS fetches): co-member names for the
  // per-user grantees, scope names for the cohorts.
  const [labels, scopeNames] = await Promise.all([
    loadDirectoryLabels(input.spaceId, { db }),
    loadScopeNames(input.spaceId, { db }),
  ]);

  // Group by resource — one entry per resource, its audience the merged per-user +
  // cohort grantees. Rows pointing at a resource the fence dropped (not in `visibleIds`)
  // are skipped entirely. The two dimensions land in ONE list, each tagged with `kind`.
  const byResource = new Map<string, ShareAudience[]>();
  const push = (resourceId: string, audience: ShareAudience) => {
    const grantees = byResource.get(resourceId) ?? [];
    grantees.push(audience);
    byResource.set(resourceId, grantees);
  };
  for (const row of userRows) {
    if (!visibleIds.has(row.resource_id)) {
      continue;
    }
    const label = labels.get(row.user_id) ?? { displayName: null, email: null };
    push(row.resource_id, {
      kind: 'user',
      userId: row.user_id,
      displayName: memberLabel({ userId: row.user_id, ...label }),
      email: label.email,
    });
  }
  for (const row of cohortRows) {
    if (!visibleIds.has(row.resource_id)) {
      continue;
    }
    push(row.resource_id, {
      kind: 'cohort',
      userId: row.scope_id,
      displayName: scopeNames.get(row.scope_id) ?? row.scope_id.slice(0, 8),
      email: null,
    });
  }

  return Array.from(byResource.entries()).map(([resourceId, grantees]) => ({
    resourceId,
    grantees: grantees.slice().sort(byText((g) => g.displayName)),
  }));
}
