import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { Skeleton } from '@workspace/ui/components/skeleton';
import {
  PLATFORM_LOCALE_COOKIE,
  PLATFORM_FEATURE_FLAG_KEYS,
  RUNTIME_SETTING_KEYS,
} from '@workspace/settings-runtime';

import {
  listAccessibleSpacesForUser,
  readActiveSpaceIdFromCookies,
  resolveActiveSpaceIdForAccessibleSpaces,
} from '@/lib/active-space';
import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { getIsSuperAdminForUser } from '@/lib/platform-nav-roles';
import { listOrganizationCustomRolesAction } from '@/lib/platform-role-catalog.actions';
import type { PlatformRoleCatalogRow } from '@/lib/platform-role-catalog.actions';
import { listInvitableSpaceRolesForUser } from '@/lib/platform-role-catalog';
import {
  getScopedRuntimeSettingValue,
  resolvePlatformFeatureFlagResolutionsForSession,
  resolveScopedPlatformLocaleValue,
  resolvePlatformLocaleForSession,
} from '@/lib/runtime-settings.server';
import { listSpaceMemberRoleAssignmentsAction } from '@/lib/space-member-role.actions';
import type { SpaceMemberRoleAssignmentRow } from '@/lib/space-member-role.actions';
import { getIsUserSpaceAdminForSpace } from '@/lib/platform-space-admin';
import { createClient } from '@/lib/supabase/server';
import {
  getSpaceSettingsLocaleOptions,
  getServerSpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.i18n';
import {
  getRoleInfo,
  resolveSpaceAdminDelegationRows,
} from '@/app/(account)/space-settings/space-settings.helpers';
import {
  SpaceAvatarSection,
  SpaceDelegationPolicySection,
  SpaceFeatureVisibilitySection,
  SpaceInvitesSection,
  SpaceMemberRolesSection,
  SpaceOrgRolesSection,
  SpaceRuntimeSettingsSection,
} from '@/app/(account)/space-settings/sections';
import { cookies, headers } from 'next/headers';

function SpaceSettingsFallback() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

async function SpaceSettingsContent() {
  await connection();
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    redirect('/auth/login');
  }

  const uid = userData.user.id;
  const cookieActiveSpaceId = readActiveSpaceIdFromCookies(await cookies());
  const { spaces: accessibleSpaces } = await listAccessibleSpacesForUser(
    supabase,
    uid
  );
  const activeSpaceId = resolveActiveSpaceIdForAccessibleSpaces(
    accessibleSpaces,
    cookieActiveSpaceId
  );

  if (!activeSpaceId) {
    redirect('/profile');
  }

  const [isSuperAdmin, isActiveSpaceAdmin] = await Promise.all([
    getIsSuperAdminForUser(supabase, uid),
    getIsUserSpaceAdminForSpace(supabase, uid, activeSpaceId),
  ]);

  const { data: spaceRow } = await supabase
    .from('spaces')
    .select('id,name,slug,organization_id,avatar_url')
    .eq('id', activeSpaceId)
    .maybeSingle();

  if (!spaceRow) {
    redirect('/profile');
  }

  const locale = await resolvePlatformLocaleForSession(supabase, {
    acceptLanguage: (await headers()).get('accept-language'),
    localeCookie: (await cookies()).get(PLATFORM_LOCALE_COOKIE)?.value ?? null,
    userId: uid,
    activeSpaceId,
    organizationId: String(spaceRow.organization_id),
  });
  const t = await getServerSpaceSettingsTranslator(locale);
  const featureFlagResolutions =
    await resolvePlatformFeatureFlagResolutionsForSession({
      userId: uid,
      activeSpaceId,
      organizationId: String(spaceRow.organization_id),
    });
  const organizationSettingsFeature =
    featureFlagResolutions[PLATFORM_FEATURE_FLAG_KEYS.organizationSettings];

  const scopedLocale = await getScopedRuntimeSettingValue(
    supabase,
    'space',
    activeSpaceId,
    RUNTIME_SETTING_KEYS.platformLocale
  );
  const localeOptions = getSpaceSettingsLocaleOptions(t);

  const isOrgAdminForSpace =
    spaceRow.organization_id != null
      ? await getIsOrgAdminForOrganization(
          supabase,
          uid,
          String(spaceRow.organization_id)
        )
      : false;

  if (!isSuperAdmin && !isOrgAdminForSpace && !isActiveSpaceAdmin) {
    redirect('/profile');
  }

  const invitableRoles = await listInvitableSpaceRolesForUser(
    supabase,
    uid,
    activeSpaceId
  );

  if (invitableRoles.length === 0) {
    redirect('/profile');
  }

  const canManageRoleCatalog = isSuperAdmin || isOrgAdminForSpace;
  let customRoles: PlatformRoleCatalogRow[] = [];
  let customRolesError: string | null = null;
  let permissionCatalogKeys: string[] = [];
  let memberRolesError: string | null = null;
  let memberRoleRows: SpaceMemberRoleAssignmentRow[] = [];
  let spaceAdminPermissionKeys: string[] = [];
  let delegationPolicyError: string | null = null;

  const memberRolesResult =
    await listSpaceMemberRoleAssignmentsAction(activeSpaceId);
  if (memberRolesResult.ok) {
    memberRoleRows = memberRolesResult.members;
  } else {
    memberRolesError = memberRolesResult.message;
  }

  if (canManageRoleCatalog) {
    const rolesResult = await listOrganizationCustomRolesAction(
      String(spaceRow.organization_id)
    );
    if (rolesResult.ok) {
      customRoles = rolesResult.roles;
    } else {
      customRolesError = rolesResult.message;
    }

    const { data: permissionRows } = await supabase
      .from('permissions')
      .select('key')
      .order('key', { ascending: true });
    permissionCatalogKeys = (permissionRows ?? [])
      .map((row) => row.key)
      .filter((key): key is string => Boolean(key));
  }

  const { data: spaceAdminRoleRows, error: spaceAdminRoleErr } = await supabase
    .from('roles')
    .select('id,owner_organization_id')
    .eq('key', 'space_admin')
    .eq('scope', 'space')
    .is('archived_at', null)
    .or(
      `owner_organization_id.is.null,owner_organization_id.eq.${spaceRow.organization_id}`
    );

  if (spaceAdminRoleErr) {
    delegationPolicyError = t('spaceSettings.delegation.errors.loadPolicy');
  } else {
    const effectiveSpaceAdminRole =
      (spaceAdminRoleRows ?? []).find(
        (row) => row.owner_organization_id === spaceRow.organization_id
      ) ??
      (spaceAdminRoleRows ?? []).find(
        (row) => row.owner_organization_id == null
      );

    if (!effectiveSpaceAdminRole?.id) {
      delegationPolicyError = t('spaceSettings.delegation.errors.missingRole');
    } else {
      const { data: mappingRows, error: mappingErr } = await supabase
        .from('role_permission')
        .select(
          'permission:permissions!role_permission_permission_id_fkey(key)'
        )
        .eq('role_id', effectiveSpaceAdminRole.id);

      if (mappingErr) {
        delegationPolicyError = t('spaceSettings.delegation.errors.loadPolicy');
      } else {
        spaceAdminPermissionKeys = [
          ...new Set(
            (mappingRows ?? [])
              .map((row) => {
                const value = row.permission;
                if (Array.isArray(value)) {
                  return value[0]?.key ?? null;
                }
                return value?.key ?? null;
              })
              .filter((key): key is string => Boolean(key))
          ),
        ];
      }
    }
  }

  const spaceAdminDelegationRows = resolveSpaceAdminDelegationRows(
    spaceAdminPermissionKeys
  );

  const { data: pendingRows } = await supabase
    .from('space_invites')
    .select(
      'id,space_id,email,expires_at,token,role:roles!space_invites_role_id_fkey(key,label)'
    )
    .eq('status', 'pending')
    .eq('space_id', activeSpaceId);

  const pendingInvites = (pendingRows ?? []).map((row) => {
    const roleInfo = getRoleInfo(row.role);
    const resolvedRoleKey = roleInfo.key ?? 'member';
    return {
      id: row.id,
      email: row.email,
      roleKey: resolvedRoleKey,
      roleLabel: roleInfo.label ?? resolvedRoleKey,
      expiresAt: row.expires_at,
      token: row.token,
    };
  });

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('spaceSettings.title')}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t('spaceSettings.subtitle')}
        </p>
      </div>

      <SpaceAvatarSection
        spaceId={spaceRow.id}
        spaceName={spaceRow.name}
        spaceSlug={spaceRow.slug}
        avatarUrl={spaceRow.avatar_url ?? null}
        t={t}
      />

      <SpaceInvitesSection
        spaceId={spaceRow.id}
        spaceName={spaceRow.name}
        spaceSlug={spaceRow.slug}
        locale={locale}
        invitableRoles={invitableRoles}
        pendingInvites={pendingInvites}
        t={t}
      />

      <SpaceRuntimeSettingsSection
        spaceId={spaceRow.id}
        currentValue={resolveScopedPlatformLocaleValue(scopedLocale, {
          allowInherit: true,
          source: 'space scope',
        })}
        localeOptions={localeOptions}
        t={t}
      />

      <SpaceFeatureVisibilitySection
        spaceId={spaceRow.id}
        feature={organizationSettingsFeature}
        t={t}
      />

      <SpaceMemberRolesSection
        spaceId={spaceRow.id}
        locale={locale}
        roleOptions={invitableRoles}
        members={memberRoleRows}
        errorMessage={memberRolesError}
        t={t}
      />

      <SpaceDelegationPolicySection
        spaceId={spaceRow.id}
        rows={spaceAdminDelegationRows}
        errorMessage={delegationPolicyError}
        t={t}
      />

      {canManageRoleCatalog ? (
        <SpaceOrgRolesSection
          organizationId={String(spaceRow.organization_id)}
          roles={customRoles}
          permissionCatalogKeys={permissionCatalogKeys}
          locale={locale}
          errorMessage={customRolesError}
          t={t}
        />
      ) : null}
    </div>
  );
}

export default function SpaceSettingsPage() {
  return (
    <Suspense fallback={<SpaceSettingsFallback />}>
      <SpaceSettingsContent />
    </Suspense>
  );
}
