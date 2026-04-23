import 'server-only';

import { createServiceRoleSupabaseClient } from '@/lib/supabase/service-role';

export const PLATFORM_SUPER_ADMIN_CAPABILITY_KEY = 'platform.admin.override';
export const PLATFORM_SUPER_ADMIN_MAX_ACTIVE = 3;

type PlatformSuperAdminProfileRow = Readonly<{
  user_id: string;
  email: string | null;
  display_name: string | null;
}>;

type PlatformSuperAdminAuthRow = Readonly<{
  email: string | null;
  lastSignInAt: string | null;
}>;

export type PlatformSuperAdminRow = Readonly<{
  userId: string;
  email: string | null;
  displayName: string | null;
  grantedAt: string;
  grantedByUserId: string | null;
  grantedByLabel: string | null;
  reason: string | null;
  lastSignInAt: string | null;
}>;

export type ListPlatformSuperAdminsResult =
  | {
      ok: true;
      superAdmins: PlatformSuperAdminRow[];
      activeCount: number;
      maxActiveCount: number;
    }
  | {
      ok: false;
      message: string;
      superAdmins: PlatformSuperAdminRow[];
      activeCount: number;
      maxActiveCount: number;
    };

async function loadPlatformSuperAdminAuthIndex(
  userIds: readonly string[]
): Promise<Map<string, PlatformSuperAdminAuthRow>> {
  const admin = createServiceRoleSupabaseClient();
  const authEntries = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data.user) {
        return [userId, null] as const;
      }

      return [
        userId,
        {
          email: data.user.email?.trim().toLowerCase() ?? null,
          lastSignInAt: data.user.last_sign_in_at ?? null,
        },
      ] as const;
    })
  );

  return new Map(
    authEntries.filter(
      (entry): entry is readonly [string, PlatformSuperAdminAuthRow] => {
        return entry[1] !== null;
      }
    )
  );
}

function normalizePlatformSuperAdminErrorMessage(message?: string): string {
  const fallback = 'Could not load platform super admins.';
  if (!message) {
    return fallback;
  }

  return process.env.NODE_ENV === 'development' ? message : fallback;
}

export async function listPlatformSuperAdmins(): Promise<ListPlatformSuperAdminsResult> {
  try {
    const admin = createServiceRoleSupabaseClient();
    const { data: grantRows, error: grantErr } = await admin.rpc(
      'rpc_service_role_list_platform_super_admin_grants'
    );

    if (grantErr) {
      return {
        ok: false,
        message: normalizePlatformSuperAdminErrorMessage(grantErr.message),
        superAdmins: [],
        activeCount: 0,
        maxActiveCount: PLATFORM_SUPER_ADMIN_MAX_ACTIVE,
      };
    }

    const activeGrants = grantRows ?? [];
    const relatedUserIds = [
      ...new Set(
        activeGrants
          .flatMap((grant) => [grant.user_id, grant.granted_by_user_id])
          .filter((userId): userId is string => Boolean(userId))
      ),
    ];

    const { data: profileRows } = relatedUserIds.length
      ? await admin
          .from('profiles')
          .select('user_id,email,display_name')
          .in('user_id', relatedUserIds)
      : { data: [] as PlatformSuperAdminProfileRow[] };

    const profileByUserId = new Map(
      (profileRows ?? []).map((row) => [row.user_id, row])
    );
    const authByUserId = await loadPlatformSuperAdminAuthIndex(relatedUserIds);

    const superAdmins: PlatformSuperAdminRow[] = activeGrants.map((grant) => {
      const userProfile = profileByUserId.get(grant.user_id);
      const userAuth = authByUserId.get(grant.user_id);
      const grantedByProfile = grant.granted_by_user_id
        ? profileByUserId.get(grant.granted_by_user_id)
        : null;
      const grantedByAuth = grant.granted_by_user_id
        ? authByUserId.get(grant.granted_by_user_id)
        : null;
      const grantedByLabel = grantedByProfile?.display_name?.trim()
        ? grantedByProfile.display_name.trim()
        : (grantedByAuth?.email ??
          grantedByProfile?.email ??
          grant.granted_by_user_id);

      return {
        userId: grant.user_id,
        email: userAuth?.email ?? userProfile?.email ?? null,
        displayName: userProfile?.display_name?.trim() || null,
        grantedAt: grant.granted_at,
        grantedByUserId: grant.granted_by_user_id,
        grantedByLabel: grantedByLabel ?? null,
        reason: grant.reason?.trim() || null,
        lastSignInAt: userAuth?.lastSignInAt ?? null,
      };
    });

    return {
      ok: true,
      superAdmins,
      activeCount: superAdmins.length,
      maxActiveCount: PLATFORM_SUPER_ADMIN_MAX_ACTIVE,
    };
  } catch (error) {
    return {
      ok: false,
      message: normalizePlatformSuperAdminErrorMessage(
        error instanceof Error ? error.message : undefined
      ),
      superAdmins: [],
      activeCount: 0,
      maxActiveCount: PLATFORM_SUPER_ADMIN_MAX_ACTIVE,
    };
  }
}
