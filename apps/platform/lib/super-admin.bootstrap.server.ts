import 'server-only';

import type { Database } from '@workspace/db';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function getConfiguredInitialPlatformSuperAdminEmail(): string | null {
  return normalizeEmail(process.env.PLATFORM_INITIAL_SUPER_ADMIN_EMAIL);
}

export async function ensureInitialPlatformSuperAdminForUser(
  supabase: SupabaseClient<Database>,
  user: Pick<User, 'id' | 'email'>
): Promise<void> {
  const configuredEmail = getConfiguredInitialPlatformSuperAdminEmail();
  const userEmail = normalizeEmail(user.email);

  if (!configuredEmail || !userEmail || userEmail !== configuredEmail) {
    return;
  }

  if (
    await hasCriticalCapability(
      supabase,
      CRITICAL_CAPABILITY_KEYS.platformAdminOverride
    )
  ) {
    return;
  }

  const admin = createServiceRoleSupabaseClient();
  const { data, error } = await admin.rpc(
    'rpc_bootstrap_initial_platform_super_admin',
    {
      p_user_id: user.id,
      p_expected_email: configuredEmail,
      p_reason: 'Configured env bootstrap',
    }
  );

  if (error) {
    throw new Error(
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'Could not bootstrap the initial platform super admin.'
    );
  }

  const status =
    data && typeof data === 'object' && 'status' in data
      ? String((data as Record<string, unknown>).status ?? '')
      : '';

  if (
    status === '' ||
    status === 'granted' ||
    status === 'already_sealed' ||
    status === 'sealed_existing_grant' ||
    status === 'already_granted' ||
    status === 'skipped_existing_super_admins'
  ) {
    return;
  }
}
