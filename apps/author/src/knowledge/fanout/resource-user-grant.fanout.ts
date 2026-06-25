import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import { byText } from '@workspace/ui/lib/sort';

import type { GrantableMember, UserGrant } from '@/app/graph/graph-data.types';

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
 * The GRANTABLE picker source (Fork 2): the bounded, searchable co-member directory of the
 * resource's space (ADR-0020), MINUS the owner, MINUS those already granted. The directory
 * RPC is searchable (`query`) + hard-limited at the source (Defect 2 — never load-all); the
 * owner + already-granted subtraction stays caller-side (the directory is generic, ADR-0020
 * §5). The list is a UX convenience — the same-space guard + RLS are the fence, so a stale
 * list can only ever produce a clean no-op insert, never a leak.
 *
 * Order: preserved from the directory's own `display_name` SQL ordering (the bounded fetch);
 * the UI applies its canonical text sorter to the final shown set (ADR-0020 §4). The owner +
 * granted subtraction happens AFTER the limit, so the result may carry fewer than `limit`
 * rows — accepted for v1 (ADR-0020 §5).
 */
export async function listGrantableMembers(
  input: { resourceId: string; query?: string },
  deps: { db: SupabaseClient<Database> }
): Promise<GrantableMember[]> {
  const { db } = deps;

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
    return [];
  }

  const [directoryResult, grantsResult] = await Promise.all([
    db.rpc('space_member_directory', {
      p_space_id: resource.space_id,
      p_query: input.query,
      p_limit: DIRECTORY_LIMIT,
    }),
    db
      .from('knowledge_resource_user_grants')
      .select('user_id')
      .eq('resource_id', input.resourceId),
  ]);
  if (directoryResult.error) {
    throw new Error(
      `listGrantableMembers directory: ${directoryResult.error.message}`
    );
  }
  if (grantsResult.error) {
    throw new Error(
      `listGrantableMembers grants: ${grantsResult.error.message}`
    );
  }

  const granted = new Set(
    (grantsResult.data ?? []).map((row) => (row as { user_id: string }).user_id)
  );
  // Preserve the directory's display_name order; subtract owner + already-granted.
  return (directoryResult.data ?? [])
    .filter(
      (row) =>
        row.user_id !== resource.owner_user_id && !granted.has(row.user_id)
    )
    .map((row) => ({
      userId: row.user_id,
      displayName: memberLabel({
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
      }),
      email: row.email,
    }));
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
