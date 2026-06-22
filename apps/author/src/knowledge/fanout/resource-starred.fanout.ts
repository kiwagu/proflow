import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Per-user "starred" write module — UI-agnostic (ADR-0005 §b / ADR-0011 §4). The
 * star flag is a column on the per-user state anchor `public.resource_user_state`
 * (a 1:1 row per (user, resource)), NOT a `kb` satellite. This is the write seam;
 * the route is a thin transport and the view holds none of this logic. EVERY write
 * runs under the user's RLS-scoped `db`; the existing own-rows insert/update
 * policies (verb space.knowledge.progress) are the sole write authority — star
 * toggling deliberately shares the per-user-state write path.
 */

export type ResourceStarredDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (own-row key). */
  userId: string;
};

const ON_USER_RESOURCE = 'user_id,resource_id' as const;

export type SetResourceStarredInput = {
  spaceId: string;
  nodeId: string;
  starred: boolean;
};

export type ResourceStarredState = {
  resource_id: string;
  starred: boolean;
};

/**
 * Set/clear a resource's `starred` flag for the current user (UPSERT by
 * (user_id, resource_id)) under the user's RLS. On insert, the row carries
 * user_id/resource_id/space_id; coarse_status falls to its DB default. RLS rejects
 * a user without space.knowledge.progress in the space → clean failure, no row.
 */
export async function setResourceStarred(
  input: SetResourceStarredInput,
  deps: ResourceStarredDeps
): Promise<ResourceStarredState> {
  const { db, userId } = deps;
  const { data, error } = await db
    .from('resource_user_state')
    .upsert(
      {
        user_id: userId,
        resource_id: input.nodeId,
        space_id: input.spaceId,
        starred: input.starred,
      },
      { onConflict: ON_USER_RESOURCE }
    )
    .select('resource_id,starred')
    .single();
  if (error || !data) {
    // RLS rejection (no progress verb / resource not accessible) → clean failure.
    throw new Error(`setResourceStarred: ${error?.message ?? 'no row'}`);
  }
  return { resource_id: data.resource_id, starred: data.starred };
}
