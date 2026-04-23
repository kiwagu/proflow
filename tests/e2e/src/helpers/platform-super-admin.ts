import type { Database } from '@workspace/db';
import { createClient } from '@supabase/supabase-js';

import { resolveServiceRoleKey, resolveSupabaseUrl } from './test-user.js';

const PLATFORM_SUPER_ADMIN_CAPABILITY_KEY = 'platform.admin.override';

export type E2EPlatformSuperAdminGrant = Readonly<{
  userId: string;
  email: string | null;
  reason: string | null;
}>;

type BootstrapPlatformSuperAdminRpcResult = Readonly<{
  ok?: boolean;
  status?: string;
  grant_id?: string;
}>;

type ListPlatformSuperAdminGrantRpcRow = Readonly<{
  granted_at: string;
  granted_by_user_id: string;
  reason: string;
  user_id: string;
}>;

function createServiceRoleSupabase() {
  return createClient<Database>(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function listPlatformSuperAdminsForE2E(): Promise<
  E2EPlatformSuperAdminGrant[]
> {
  const supabase = createServiceRoleSupabase();

  const { data, error } = await supabase.rpc(
    'rpc_service_role_list_platform_super_admin_grants'
  );

  if (error) {
    throw new Error(
      `listPlatformSuperAdminsForE2E: list rpc failed: ${error.message ?? 'unknown error'}`
    );
  }

  const grants = (data ?? []) as ListPlatformSuperAdminGrantRpcRow[];
  const authUsers = await Promise.all(
    grants.map(async (grant) => {
      const { data: userData, error: userError } =
        await supabase.auth.admin.getUserById(grant.user_id);

      if (userError || !userData.user) {
        return [grant.user_id, null] as const;
      }

      return [
        grant.user_id,
        userData.user.email?.trim().toLowerCase() ?? null,
      ] as const;
    })
  );

  const emailByUserId = new Map(authUsers);

  return grants.map((grant) => ({
    userId: grant.user_id,
    email: emailByUserId.get(grant.user_id) ?? null,
    reason: grant.reason?.trim() || null,
  }));
}

export async function bootstrapPlatformSuperAdminForUser(
  userId: string,
  reason = 'e2e bootstrap platform super admin'
): Promise<void> {
  const supabase = createServiceRoleSupabase();

  const { data: bootstrapResult, error: bootstrapError } = await supabase.rpc(
    'rpc_service_role_grant_platform_super_admin',
    {
      p_target_user_id: userId,
      p_reason: reason,
    }
  );

  if (bootstrapError) {
    throw new Error(
      `bootstrapPlatformSuperAdminForUser: bootstrap rpc failed: ${bootstrapError.message ?? 'unknown error'}`
    );
  }

  const bootstrapStatus =
    bootstrapResult && typeof bootstrapResult === 'object'
      ? ((bootstrapResult as BootstrapPlatformSuperAdminRpcResult).status ??
        'unknown')
      : 'unknown';

  const { data: hasCapability, error: capabilityError } = await supabase.rpc(
    'auth_user_has_critical_capability',
    {
      p_user_id: userId,
      p_capability_key: PLATFORM_SUPER_ADMIN_CAPABILITY_KEY,
    }
  );

  if (capabilityError) {
    throw new Error(
      `bootstrapPlatformSuperAdminForUser: capability verification failed: ${capabilityError.message ?? 'unknown error'}`
    );
  }

  if (hasCapability === true) {
    return;
  }

  throw new Error(
    `bootstrapPlatformSuperAdminForUser: user is still not a platform super admin after service-role grant rpc (status=${bootstrapStatus}).`
  );
}
