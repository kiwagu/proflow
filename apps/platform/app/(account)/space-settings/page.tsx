import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';
import { Skeleton } from '@workspace/ui/components/skeleton';
import {
  PLATFORM_LOCALE_COOKIE,
  PLATFORM_FEATURE_FLAG_KEYS,
  RUNTIME_SETTING_KEYS,
} from '@workspace/settings-runtime';

import { SpaceInviteManagerClient } from '@/app/(account)/organizations/space-invite.manager.client';
import { OrganizationRoleCatalogClient } from '@/app/(account)/space-settings/organization-role-catalog.client';
import { SpaceAvatarForm } from '@/app/(account)/space-settings/space-avatar-form';
import { SpaceMemberRolesClient } from '@/app/(account)/space-settings/space-member-roles.client';
import { RuntimeSettingSelectForm } from '@/components/runtime-setting-select-form';
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
  type PlatformFeatureFlagResolutionSource,
} from '@/lib/runtime-settings.server';
import { listSpaceMemberRoleAssignmentsAction } from '@/lib/space-member-role.actions';
import type { SpaceMemberRoleAssignmentRow } from '@/lib/space-member-role.actions';
import { getIsUserSpaceAdminForSpace } from '@/lib/platform-space-admin';
import { createClient } from '@/lib/supabase/server';
import {
  getSpaceSettingsLocaleOptions,
  getServerSpaceSettingsTranslator,
  getSpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.i18n';
import { cookies, headers } from 'next/headers';

const delegatedDomainUserPermissionKeys = [
  'space.users.create',
  'space.users.read',
  'space.users.update',
  'space.users.delete',
] as const;

type DelegatedDomainUserOperation =
  (typeof delegatedDomainUserPermissionKeys)[number];

function resolveSpaceAdminDelegationRows(permissionKeys: readonly string[]) {
  const grantedKeys = new Set(permissionKeys);
  return delegatedDomainUserPermissionKeys.map((key) => ({
    key,
    allowed: grantedKeys.has(key),
  }));
}

function getRoleInfo(
  role:
    | { key: string | null; label: string | null }
    | { key: string | null; label: string | null }[]
    | null
    | undefined
): { key: string | null; label: string | null } {
  const row = Array.isArray(role) ? role[0] : role;
  const key =
    typeof row?.key === 'string' && row.key.length > 0 ? row.key : null;
  const label =
    typeof row?.label === 'string' && row.label.length > 0 ? row.label : null;
  return { key, label };
}

function resolveFeatureStateBadgeLabel(
  enabled: boolean,
  t: ReturnType<typeof getSpaceSettingsTranslator>
) {
  return enabled
    ? t('spaceSettings.featureVisibility.state.enabled')
    : t('spaceSettings.featureVisibility.state.disabled');
}

function resolveFeatureSourceLabel(
  source: PlatformFeatureFlagResolutionSource,
  t: ReturnType<typeof getSpaceSettingsTranslator>
) {
  if (source === 'organization_disabled') {
    return t('spaceSettings.featureVisibility.source.organizationDisabled');
  }

  if (source === 'space_enabled') {
    return t('spaceSettings.featureVisibility.source.spaceEnabled');
  }

  if (source === 'space_disabled') {
    return t('spaceSettings.featureVisibility.source.spaceDisabled');
  }

  if (source === 'organization') {
    return t('spaceSettings.featureVisibility.source.organization');
  }

  return t('spaceSettings.featureVisibility.source.globalDefault');
}

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

  function getDelegationOperationLabel(
    operation: DelegatedDomainUserOperation
  ) {
    if (operation === 'space.users.create') {
      return t('spaceSettings.delegation.operations.create');
    }
    if (operation === 'space.users.read') {
      return t('spaceSettings.delegation.operations.read');
    }
    if (operation === 'space.users.update') {
      return t('spaceSettings.delegation.operations.update');
    }
    return t('spaceSettings.delegation.operations.delete');
  }

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

      <Card>
        <CardHeader>
          <CardTitle>{spaceRow.name}</CardTitle>
          <CardDescription>
            {t('spaceSettings.slug', { slug: spaceRow.slug })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium">
                {t('spaceSettings.avatar.title')}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('spaceSettings.avatar.description')}
              </p>
            </div>
            <SpaceAvatarForm
              spaceId={spaceRow.id}
              currentValue={spaceRow.avatar_url ?? null}
              submitLabel={t('runtimeSettings.actions.save')}
              successMessage={t('runtimeSettings.messages.saved')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{spaceRow.name}</CardTitle>
          <CardDescription>
            {t('spaceSettings.slug', { slug: spaceRow.slug })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpaceInviteManagerClient
            spaceId={spaceRow.id}
            spaceName={spaceRow.name}
            spaceSlug={spaceRow.slug}
            locale={locale}
            invitableRoles={invitableRoles}
            pendingInvites={pendingInvites}
          />
        </CardContent>
      </Card>

      <Card data-testid={`space-language-card-${spaceRow.id}`}>
        <CardHeader>
          <CardTitle>
            {t('runtimeSettings.platformLocale.title.space')}
          </CardTitle>
          <CardDescription>
            {t('runtimeSettings.platformLocale.description.space')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuntimeSettingSelectForm
            allowInherit
            currentValue={resolveScopedPlatformLocaleValue(scopedLocale, {
              allowInherit: true,
              source: 'space scope',
            })}
            fieldLabel={t('runtimeSettings.platformLocale.fieldLabel')}
            inheritOptionLabel={t(
              'runtimeSettings.platformLocale.inherit.space'
            )}
            revalidatePath="/space-settings"
            scope="space"
            scopeId={spaceRow.id}
            settingKey={RUNTIME_SETTING_KEYS.platformLocale}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
            options={localeOptions}
            testId="space-platform-locale"
          />
        </CardContent>
      </Card>

      <Card data-testid={`space-feature-visibility-${spaceRow.id}`}>
        <CardHeader>
          <CardTitle>{t('spaceSettings.featureVisibility.title')}</CardTitle>
          <CardDescription>
            {t('spaceSettings.featureVisibility.description')}
          </CardDescription>
          <CardAction>
            <Badge
              data-testid={`space-feature-visibility-effective-${spaceRow.id}`}
              variant={
                organizationSettingsFeature.effectiveValue
                  ? 'default'
                  : 'secondary'
              }
            >
              {resolveFeatureStateBadgeLabel(
                organizationSettingsFeature.effectiveValue,
                t
              )}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <div
              className="bg-muted/30 border-border flex items-center justify-between rounded-md border px-3 py-2"
              data-testid={`space-feature-visibility-organization-gate-${spaceRow.id}`}
            >
              <span className="text-sm font-medium">
                {t('spaceSettings.featureVisibility.organizationGateLabel')}
              </span>
              <Badge
                variant={
                  organizationSettingsFeature.organizationValue
                    ? 'secondary'
                    : 'outline'
                }
              >
                {resolveFeatureStateBadgeLabel(
                  Boolean(organizationSettingsFeature.organizationValue),
                  t
                )}
              </Badge>
            </div>

            <div
              className="bg-muted/30 border-border flex items-center justify-between rounded-md border px-3 py-2"
              data-testid={`space-feature-visibility-space-activation-${spaceRow.id}`}
            >
              <span className="text-sm font-medium">
                {t('spaceSettings.featureVisibility.spaceActivationLabel')}
              </span>
              <Badge
                variant={
                  organizationSettingsFeature.spaceValue
                    ? 'secondary'
                    : 'outline'
                }
              >
                {resolveFeatureStateBadgeLabel(
                  Boolean(organizationSettingsFeature.spaceValue),
                  t
                )}
              </Badge>
            </div>

            <div
              className="bg-muted/30 border-border flex items-center justify-between rounded-md border px-3 py-2"
              data-testid={`space-feature-visibility-source-${spaceRow.id}`}
            >
              <span className="text-sm font-medium">
                {t('spaceSettings.featureVisibility.resolutionSourceLabel')}
              </span>
              <span className="text-muted-foreground text-right text-sm">
                {resolveFeatureSourceLabel(
                  organizationSettingsFeature.source,
                  t
                )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('spaceSettings.memberRoles.title')}</CardTitle>
          <CardDescription>
            {t('spaceSettings.memberRoles.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {memberRolesError ? (
            <p className="text-destructive text-sm" role="alert">
              {memberRolesError}
            </p>
          ) : (
            <SpaceMemberRolesClient
              spaceId={spaceRow.id}
              locale={locale}
              roleOptions={invitableRoles}
              members={memberRoleRows}
            />
          )}
        </CardContent>
      </Card>

      <Card data-testid={`space-delegation-policy-${spaceRow.id}`}>
        <CardHeader>
          <CardTitle>{t('spaceSettings.delegation.title')}</CardTitle>
          <CardDescription>
            {t('spaceSettings.delegation.description')}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">
              {t('spaceSettings.delegation.denyByDefault')}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {delegationPolicyError ? (
            <p className="text-destructive text-sm" role="alert">
              {delegationPolicyError}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {spaceAdminDelegationRows.map((row) => (
                <div
                  key={row.key}
                  className="bg-muted/30 border-border flex items-center justify-between rounded-md border px-3 py-2"
                  data-testid={`space-delegation-policy-row-${row.key.replaceAll('.', '-')}`}
                >
                  <span className="text-sm font-medium">
                    {getDelegationOperationLabel(row.key)}
                  </span>
                  <Badge variant={row.allowed ? 'secondary' : 'outline'}>
                    {row.allowed
                      ? t('spaceSettings.delegation.status.allowed')
                      : t('spaceSettings.delegation.status.denied')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {canManageRoleCatalog ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('spaceSettings.orgRoles.title')}</CardTitle>
            <CardDescription>
              {t('spaceSettings.orgRoles.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {customRolesError ? (
              <p className="text-destructive text-sm" role="alert">
                {customRolesError}
              </p>
            ) : (
              <OrganizationRoleCatalogClient
                organizationId={String(spaceRow.organization_id)}
                roles={customRoles}
                permissionCatalogKeys={permissionCatalogKeys}
                locale={locale}
              />
            )}
          </CardContent>
        </Card>
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
