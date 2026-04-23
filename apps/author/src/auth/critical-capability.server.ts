import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';

const AUTHOR_ALL_TENANTS_CAPABILITY = 'author.tenants.all';

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    return null;
  }

  return createClient<Database>(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Checks critical capability using service-role RPC.
 * Fails closed by design.
 */
export async function hasAuthorAllTenantsCapability(
  supabaseSub: string | null | undefined
): Promise<boolean> {
  const userId = supabaseSub?.trim();
  if (!userId) {
    return false;
  }

  const supabase = serviceClient();
  if (!supabase) {
    return false;
  }

  const { data, error } = await supabase.rpc(
    'auth_user_has_critical_capability',
    {
      p_user_id: userId,
      p_capability_key: AUTHOR_ALL_TENANTS_CAPABILITY,
    }
  );

  if (error) {
    return false;
  }
  return data === true;
}
