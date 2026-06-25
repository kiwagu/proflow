import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { byText } from '@workspace/ui/lib/sort';

import type {
  GrantableMember,
  GrantableMembersPage,
  UserGrant,
} from '@/app/graph/graph-data.types';
import {
  decodeDirectoryCursor,
  encodeDirectoryCursor,
} from '@/knowledge/fanout/directory-cursor';

/**
 * Per-user (per-person) sharing — the THIRD additive grant dimension (ADR-0019).
 * A per-user GRANT links one resource to one identified space member; it WIDENS that
 * person's read visibility on top of the broadcast floor (ADR-0017 Model B) and never
 * fences. Grants are NOT graph edges — a separate access dimension
 * (`knowledge_resource_user_grants`), never `knowledge_edges` (Invariant #1 unaffected).
 *
 * EVERY read/write runs under the user's RLS-scoped `db` — never service-role. RLS is
 * the SOLE authority: grant/revoke gate on the owner-sovereign OR `space.knowledge.access`
 * policy on the grant table; `granted_by` is pinned to the caller (never the body). The
 * same-space guard (grantee ∈ the resource's space) is enforced by a DB trigger.
 *
 * Display names: co-member rows of `space_memberships` are readable to any space
 * participant, but `profiles` is OWN-ROW-only under RLS — so a direct join to profiles
 * resolves only the CALLER's own display name. Identity for OTHER members is resolved via
 * the `space_member_directory` SECURITY-DEFINER RPC (ADR-0020): gated by the caller's own
 * active membership of the space (the fence — non-member → ∅, zero service-role), it
 * returns `display_name` + `email` for co-members and is searchable + hard-limited at the
 * source. The picker remains a UX convenience, not the fence (Fork 2) — the same-space
 * guard + grant RLS stay the authority.
 */

/** Hard cap mirrored from the directory function (`least(…, 50)`); the default the RPC
 * uses when `p_limit` is omitted. */
const DIRECTORY_LIMIT = 50;

/** The picker's default page size (ADR-0021 A3): a small page of 5 + "+N more". The
 * caller may override; the directory function clamps to ≤50 regardless. */
const GRANTABLE_PAGE_SIZE = 5;

type DirectoryLabel = { displayName: string | null; email: string | null };

/** Resolve a display label for a member from the directory fields. */
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
 * Fetch the co-member directory for a space and key it by user_id (ADR-0020). One
 * RLS-respecting RPC call: the SECURITY-DEFINER function returns co-member
 * `display_name` + `email` ONLY when the caller is an active member of the space (else ∅).
 * `query` narrows server-side; the function caps the result (max 50) regardless.
 */
async function loadDirectoryLabels(
  input: { spaceId: string; query?: string; limit?: number },
  deps: { db: SupabaseClient<Database> }
): Promise<Map<string, DirectoryLabel>> {
  const labels = new Map<string, DirectoryLabel>();
  const { data, error } = await deps.db.rpc('space_member_directory', {
    p_space_id: input.spaceId,
    p_query: input.query,
    p_limit: input.limit ?? DIRECTORY_LIMIT,
  });
  if (error) {
    throw new Error(`loadDirectoryLabels: ${error.message}`);
  }
  for (const row of data ?? []) {
    labels.set(row.user_id, {
      displayName: row.display_name,
      email: row.email,
    });
  }
  return labels;
}

/**
 * The node's current per-user grants, with a display label + email for each grantee
 * (read/query). RLS-scoped reads: the resource's space (RLS mirrors node read), the node's
 * grant rows, and the co-member directory for that space (ADR-0020 — one bounded fetch
 * resolves the small fixed grantee set). Sorted by display name via the canonical text
 * sorter (`@workspace/ui/lib/sort` → `@workspace/std`).
 */
export async function listUserGrants(
  input: { resourceId: string },
  deps: { db: SupabaseClient<Database> }
): Promise<UserGrant[]> {
  const { db } = deps;

  // The resource's space (RLS mirrors node read). Absent → not visible.
  const { data: resourceRow, error: resourceErr } = await db
    .from('knowledge_resources')
    .select('space_id')
    .eq('id', input.resourceId)
    .maybeSingle();
  if (resourceErr) {
    throw new Error(`listUserGrants resource: ${resourceErr.message}`);
  }
  const resource = resourceRow as { space_id: string } | null;
  if (!resource) {
    return [];
  }

  const { data, error } = await db
    .from('knowledge_resource_user_grants')
    .select('user_id,granted_by')
    .eq('resource_id', input.resourceId);
  if (error) {
    throw new Error(`listUserGrants: ${error.message}`);
  }
  const rows = (data ?? []).map(
    (row) => row as { user_id: string; granted_by: string }
  );
  if (rows.length === 0) {
    return [];
  }

  const labels = await loadDirectoryLabels(
    { spaceId: resource.space_id },
    { db }
  );
  return rows
    .map((r) => {
      const label = labels.get(r.user_id) ?? { displayName: null, email: null };
      return {
        userId: r.user_id,
        displayName: memberLabel({ userId: r.user_id, ...label }),
        email: label.email,
        grantedBy: r.granted_by,
      };
    })
    .sort(byText((m: UserGrant) => m.displayName));
}

/**
 * The GRANTABLE picker source (ADR-0021 Part A): ONE keyset page of the bounded, searchable
 * co-member directory of the resource's space (ADR-0020), with the owner + already-granted
 * EXCLUDED at the source (passed as `p_exclude`, applied BEFORE the limit AND before the
 * count). So the page is `limit` REAL grantable candidates and `total` is the count of
 * grantable matches for the query — the picker shows a small page + an accurate "+N more".
 *
 * Paging (A1): the opaque `cursor` decodes into the directory's `(p_after_key, p_after_user)`
 * keyset seek — a drift-free resume of the stable `(sort_key, user_id)` order. `cursor=null`
 * (or a new query) is page 1. `nextCursor` is built from the LAST returned row when a full
 * page came back AND more matches remain; `null` otherwise (no more pages).
 *
 * The list is a UX convenience — the same-space guard + grant RLS are the fence, so a stale
 * page can only ever produce a clean no-op insert, never a leak (the directory itself is
 * membership-fenced: a non-member gets ∅ + total 0). Order is preserved from the directory's
 * own stable SQL ordering; the UI applies its canonical text sorter to the shown set
 * (ADR-0020 §4 / ADR-0021 §8).
 */
export async function listGrantableMembers(
  input: {
    resourceId: string;
    query?: string;
    cursor?: string;
    limit?: number;
  },
  deps: { db: SupabaseClient<Database> }
): Promise<GrantableMembersPage> {
  const { db } = deps;
  const limit = Math.min(
    Math.max(input.limit ?? GRANTABLE_PAGE_SIZE, 1),
    DIRECTORY_LIMIT
  );

  // The resource's space + owner (RLS mirrors node read). Absent → not visible.
  const { data: resourceRow, error: resourceErr } = await db
    .from('knowledge_resources')
    .select('space_id,owner_user_id')
    .eq('id', input.resourceId)
    .maybeSingle();
  if (resourceErr) {
    throw new Error(`listGrantableMembers resource: ${resourceErr.message}`);
  }
  const resource = resourceRow as {
    space_id: string;
    owner_user_id: string | null;
  } | null;
  if (!resource) {
    return { items: [], nextCursor: null, total: 0 };
  }

  // Read the already-granted set FIRST so it joins the owner in the server-side exclusion
  // (A5: exclude before the limit + count, never a caller-side post-limit subtraction).
  const { data: grantRows, error: grantsErr } = await db
    .from('knowledge_resource_user_grants')
    .select('user_id')
    .eq('resource_id', input.resourceId);
  if (grantsErr) {
    throw new Error(`listGrantableMembers grants: ${grantsErr.message}`);
  }
  const exclude = new Set<string>();
  if (resource.owner_user_id) {
    exclude.add(resource.owner_user_id);
  }
  for (const row of grantRows ?? []) {
    exclude.add((row as { user_id: string }).user_id);
  }

  const cursor = decodeDirectoryCursor(input.cursor);
  // Over-fetch by ONE row to detect a next page honestly: if a (limit+1)-th match exists,
  // there IS a next page; otherwise this is the last page — regardless of whether `total`
  // is an exact multiple of the page size. (`total_count` is a pre-LIMIT window count, so
  // the extra row never perturbs it.) Probe is clamped to the function's own hard cap.
  const probeLimit = Math.min(limit + 1, DIRECTORY_LIMIT);
  const { data, error } = await db.rpc('space_member_directory', {
    p_space_id: resource.space_id,
    p_query: input.query,
    p_limit: probeLimit,
    p_after_key: cursor?.k,
    p_after_user: cursor?.u,
    p_exclude: Array.from(exclude),
  });
  if (error) {
    throw new Error(`listGrantableMembers directory: ${error.message}`);
  }

  const rows = data ?? [];
  // total_count repeats on every row (window); 0 when the page is empty.
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  // A next page exists iff the probe row came back; the page is the first `limit` rows.
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items: GrantableMember[] = pageRows.map((row) => ({
    userId: row.user_id,
    displayName: memberLabel({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
    }),
    email: row.email,
  }));

  // Build the cursor from the LAST shown row's stable position (sort_key = display_name||email).
  let nextCursor: string | null = null;
  if (hasMore) {
    const last = pageRows[pageRows.length - 1];
    const sortKey = last.display_name?.trim() || last.email || '';
    nextCursor = encodeDirectoryCursor({ k: sortKey, u: last.user_id });
  }

  return { items, nextCursor, total };
}

export type GrantResourceToUserInput = {
  resourceId: string; // knr_…
  userId: string; // grantee (auth.users.id), must be a member of the resource's space
};

/**
 * GRANT a resource to ONE person (additive — widens that user's read access, ADR-0019).
 * Idempotent against the `(resource_id, user_id)` PK — re-granting is a no-op (the grant
 * already exists). `grantedBy` is pinned from the session. An RLS rejection (not owner /
 * no access) or the same-space guard surfaces as a clean failure.
 */
export async function grantResourceToUser(
  input: GrantResourceToUserInput & { grantedBy: string },
  deps: { db: SupabaseClient<Database> }
): Promise<{ granted: boolean }> {
  const { db } = deps;
  const { error } = await db.from('knowledge_resource_user_grants').insert({
    resource_id: input.resourceId,
    user_id: input.userId,
    granted_by: input.grantedBy,
  });
  if (error) {
    // Duplicate (already shared with this person) → success no-op.
    if (error.code === '23505') {
      return { granted: false };
    }
    // RLS rejection (no authority) / same-space guard → clean failure.
    throw new Error(`grantResourceToUser: ${error.message}`);
  }
  return { granted: true };
}

export type RevokeResourceUserGrantInput = {
  resourceId: string; // knr_…
  userId: string; // grantee to revoke
};

/**
 * REVOKE a per-user grant (narrow — the person loses read access; ADR-0019 Fork 5).
 * Visibility-neutral and fail-closed: deletes the grant row only, touches no other
 * disjunct. Returns how many rows the caller's RLS context actually deleted (0 =
 * nothing visible/permitted — a clean no-op).
 */
export async function revokeResourceUserGrant(
  input: RevokeResourceUserGrantInput,
  deps: { db: SupabaseClient<Database> }
): Promise<{ deleted: number }> {
  const { db } = deps;
  const { data, error } = await db
    .from('knowledge_resource_user_grants')
    .delete()
    .eq('resource_id', input.resourceId)
    .eq('user_id', input.userId)
    .select('resource_id');
  if (error) {
    throw new Error(`revokeResourceUserGrant: ${error.message}`);
  }
  return { deleted: data?.length ?? 0 };
}
