import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { byText } from '@workspace/ui/lib/sort';

import type { SharedByMeEntry } from '@/app/graph/graph-data.types';

/**
 * "Shared by me" lens (ADR-0021 Part B) — a READ-ONLY projection over the per-user
 * grant table for the resources the CURRENT user has shared OUT. NO new table, NO
 * resolver change, NO new access dimension: it reads `knowledge_resource_user_grants`
 * (the ADR-0019 grant table) and the co-member directory (ADR-0020), both ALREADY
 * landed. Invariant #1 holds — "Shared by me" is the OPPOSITE direction of the same
 * grant graph the "Shared with me" lens reads.
 *
 * EVERY read runs under the user's RLS-scoped `db` — NEVER service-role. RLS is the
 * SOLE authority and the fence is fail-closed by construction:
 *   - `granted_by = (select auth.uid())` is a FILTER (which grants I created), not the
 *     fence — `granted_by` is pinned to the session at insert (ADR-0019), so it cannot
 *     be forged.
 *   - the grant table's SELECT RLS (any space reader sees the grant rows of their
 *     space) + the `knowledge_resources` SELECT RLS (node read) are the fence: the
 *     resources are re-joined under RLS, so a resource I once granted but can NO LONGER
 *     see (moved, lost access, trashed-out-of-view) drops out — it never appears.
 *
 * Grantee display names: `profiles` is OWN-ROW-only under RLS, so other members are
 * labelled via the `space_member_directory` SECURITY-DEFINER RPC (gated by the caller's
 * own active membership of the space — non-member → ∅, zero service-role). v1 covers
 * per-user grants I created only; cohort-by-me (`linked_by`) is a DEFERRED additive
 * layer (ADR-0021 §7), not built here.
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
 * The resources the CURRENT user has shared OUT in a space, each with the grantee(s)
 * they granted it to (ADR-0021 Part B). All reads RLS-scoped — never service-role.
 *
 * Mechanism (read-only over landed tables):
 *   1. Grant rows in the space where `granted_by = me` — the grants I created. The grant
 *      SELECT RLS already scopes the read to my space; `granted_by = auth.uid()` filters
 *      to MINE. Resources NOT in `space_id` are excluded by the space join.
 *   2. Re-join `knowledge_resources` UNDER RLS to drop any grant whose resource I can no
 *      longer SEE (the node SELECT RLS is the fence — fail-closed). A grant pointing at a
 *      resource hidden from me (or in another space) yields no row → it vanishes.
 *   3. Resolve grantee labels via the co-member directory (one bounded RLS fetch).
 *
 * Grouped by resource (one entry per resource, N grantees), grantees sorted by display
 * name via the canonical text sorter (`@workspace/ui/lib/sort` → `@workspace/std`).
 * Empty when I have shared nothing visible — never an error.
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

  // The grants I CREATED — the grant SELECT RLS already scopes the read to MY space's
  // grant rows (it gates on the resource's `space.knowledge.read`); `granted_by = me`
  // narrows to mine. This alone is NOT the visibility fence (space-read ≠ node-read):
  // step 2 re-joins the resources under the node SELECT RLS, which is the fail-closed
  // fence (a resource I can no longer SEE drops out).
  const { data: grantRows, error: grantsErr } = await db
    .from('knowledge_resource_user_grants')
    .select('resource_id,user_id')
    .eq('granted_by', me);
  if (grantsErr) {
    throw new Error(`listResourcesSharedByMe grants: ${grantsErr.message}`);
  }

  const rows = (grantRows ?? []).map(
    (row) => row as { resource_id: string; user_id: string }
  );
  if (rows.length === 0) {
    return [];
  }

  // The FENCE (fail-closed): re-read the granted resources UNDER the node SELECT RLS,
  // narrowed to THIS space + LIVE (deleted_at IS NULL — a trashed resource leaves the
  // live lens). A resource the per-node RLS hides — or one in another space — simply
  // does not return here, so it is dropped below. Chunked to keep each `.in('id', …)`
  // request URL under the REST gateway limit (the 502 guard shared with the page load).
  const grantedResourceIds = Array.from(
    new Set(rows.map((r) => r.resource_id))
  );
  const visibleIds = await loadVisibleResourceIds(
    input.spaceId,
    grantedResourceIds,
    { db }
  );
  if (visibleIds.size === 0) {
    return [];
  }

  // Resolve grantee labels once for the whole lens (bounded RLS directory fetch).
  const labels = await loadDirectoryLabels(input.spaceId, { db });

  // Group by resource — one entry per resource, N grantees. Rows pointing at a
  // resource the fence dropped (not in `visibleIds`) are skipped entirely.
  const byResource = new Map<string, SharedByMeEntry['grantees']>();
  for (const row of rows) {
    if (!visibleIds.has(row.resource_id)) {
      continue;
    }
    const label = labels.get(row.user_id) ?? {
      displayName: null,
      email: null,
    };
    const grantees = byResource.get(row.resource_id) ?? [];
    grantees.push({
      userId: row.user_id,
      displayName: memberLabel({ userId: row.user_id, ...label }),
      email: label.email,
    });
    byResource.set(row.resource_id, grantees);
  }

  return Array.from(byResource.entries()).map(([resourceId, grantees]) => ({
    resourceId,
    grantees: grantees.slice().sort(byText((g) => g.displayName)),
  }));
}
