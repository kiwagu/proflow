import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { RbacPermissionKey } from './permissions.js';

type Scope = Readonly<{
  spaceId?: string | null;
  organizationId?: string | null;
}>;

/**
 * Permission check for the current authenticated user.
 * Deny-by-default: any RPC error or empty response returns false.
 */
export async function hasPermission(
  supabase: SupabaseClient<Database>,
  permissionKey: RbacPermissionKey | string,
  scope: Scope = {}
): Promise<boolean> {
  const { data, error } = await supabase.rpc('auth_user_has_permission', {
    p_permission_key: permissionKey,
    p_space_id: scope.spaceId ?? undefined,
    p_organization_id: scope.organizationId ?? undefined,
  });

  if (error) {
    return false;
  }
  return data === true;
}
