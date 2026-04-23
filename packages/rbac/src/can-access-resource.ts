import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { RbacPermissionKey } from './permissions.js';

export async function canAccessResource(
  supabase: SupabaseClient<Database>,
  opts: {
    permissionKey: RbacPermissionKey;
    spaceId: string;
  }
): Promise<boolean> {
  const { data, error } = await supabase.rpc('auth_user_can_access_in_space', {
    p_space_id: opts.spaceId,
    p_permission_key: opts.permissionKey,
  });

  if (error) {
    return false;
  }

  return data === true;
}
