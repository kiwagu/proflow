import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Space ids where the user is an active space admin (can manage authed-only invites).
 */
export async function getSpaceIdsWhereUserIsSpaceAdmin(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_role')
    .select(
      'space_id, roles!inner(key,role_kind,owner_organization_id,archived_at)'
    )
    .eq('user_id', userId)
    .not('space_id', 'is', null)
    .eq('roles.key', 'space_admin')
    .eq('roles.role_kind', 'system')
    .is('roles.owner_organization_id', null)
    .is('roles.archived_at', null);

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error(
        '[getSpaceIdsWhereUserIsSpaceAdmin] space_memberships:',
        error.message
      );
    }
    return [];
  }

  return (data ?? [])
    .map((row) => row.space_id)
    .filter((spaceId): spaceId is string => Boolean(spaceId));
}

/**
 * True if the user is an active space admin in the given specific space.
 */
export async function getIsUserSpaceAdminForSpace(
  supabase: SupabaseClient<Database>,
  userId: string,
  spaceId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_role')
    .select(
      'space_id, roles!inner(key,role_kind,owner_organization_id,archived_at)'
    )
    .eq('user_id', userId)
    .eq('space_id', spaceId)
    .eq('roles.key', 'space_admin')
    .eq('roles.role_kind', 'system')
    .is('roles.owner_organization_id', null)
    .is('roles.archived_at', null)
    .maybeSingle();

  if (error) {
    return false;
  }
  return !!data;
}
