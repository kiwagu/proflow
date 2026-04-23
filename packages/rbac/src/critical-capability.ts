import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

export const CRITICAL_CAPABILITY_KEYS = {
  platformAdminOverride: 'platform.admin.override',
  authorTenantsAll: 'author.tenants.all',
} as const;

export type CriticalCapabilityKey =
  (typeof CRITICAL_CAPABILITY_KEYS)[keyof typeof CRITICAL_CAPABILITY_KEYS];

/**
 * Critical capability check for the current authenticated user.
 * Deny-by-default on errors.
 */
export async function hasCriticalCapability(
  supabase: SupabaseClient<Database>,
  capabilityKey: CriticalCapabilityKey | string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'auth_current_user_has_critical_capability',
    {
      p_capability_key: capabilityKey,
    }
  );

  if (error) {
    return false;
  }
  return data === true;
}
