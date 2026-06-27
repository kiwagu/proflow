import { connection } from 'next/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import {
  PLATFORM_LOCALE_COOKIE,
  defaultPlatformFeatureFlags,
  getDefaultRuntimeSettingValue,
  PLATFORM_FEATURE_FLAG_KEYS,
  RUNTIME_SETTING_KEYS,
  runtimeLogLevelValues,
} from '@workspace/settings-runtime';

import { GlobalSystemRoleCatalogClient } from './global-system-role-catalog.client';
import { PlatformSuperAdminClient } from './platform-super-admin.client';
import { SupportSpaceActivateButton } from './support-space-activate-button.client';
import { FeatureFlagCheckboxForm } from '@/components/feature-flag-checkbox-form';
import { RuntimeSettingSelectForm } from '@/components/runtime-setting-select-form';
import {
  listAccessibleSpacesForUser,
  readActiveSpaceIdFromCookies,
  resolveActiveSpaceIdForAccessibleSpaces,
} from '@/lib/active-space';
import { listPlatformSuperAdmins } from '@/lib/platform-super-admin.server';
import { getIsSuperAdminForUser } from '@/lib/platform-nav-roles';
import {
  listGlobalSystemRolesAction,
  type PlatformRoleCatalogRow,
} from '@/lib/platform-role-catalog.actions';
import {
  getScopedRuntimeSettingValue,
  resolveScopedPlatformLocaleValue,
  resolvePlatformLocaleForSession,
} from '@/lib/runtime-settings.server';
import { createClient } from '@/lib/supabase/server';
import {
  getSpaceSettingsLocaleOptions,
  getServerSpaceSettingsTranslator,
  getSpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.i18n';
import { cookies, headers } from 'next/headers';

function OperatorConsoleFallback() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="bg-muted/50 h-48 w-full animate-pulse rounded-xl" />
    </div>
  );
}

function resolveLogLevelLabel(
  value: (typeof runtimeLogLevelValues)[number],
  t: ReturnType<typeof getSpaceSettingsTranslator>
) {
  if (value === 'fatal') {
    return t('runtimeSettings.options.logLevel.fatal');
  }

  if (value === 'error') {
    return t('runtimeSettings.options.logLevel.error');
  }

  if (value === 'warn') {
    return t('runtimeSettings.options.logLevel.warn');
  }

  if (value === 'debug') {
    return t('runtimeSettings.options.logLevel.debug');
  }

  if (value === 'trace') {
    return t('runtimeSettings.options.logLevel.trace');
  }

  return t('runtimeSettings.options.logLevel.info');
}

async function OperatorConsoleContent() {
  await connection();
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    redirect('/auth/login');
  }

  const uid = userData.user.id;
  if (!(await getIsSuperAdminForUser(supabase, uid))) {
    redirect('/profile');
  }

  const cookieActiveSpaceId = readActiveSpaceIdFromCookies(await cookies());
  const { spaces: accessibleSpaces } = await listAccessibleSpacesForUser(
    supabase,
    uid
  );
  const activeSpaceId = resolveActiveSpaceIdForAccessibleSpaces(
    accessibleSpaces,
    cookieActiveSpaceId
  );
  const activeSpace =
    accessibleSpaces.find((space) => space.id === activeSpaceId) ?? null;
  const locale = await resolvePlatformLocaleForSession(supabase, {
    acceptLanguage: (await headers()).get('accept-language'),
    localeCookie: (await cookies()).get(PLATFORM_LOCALE_COOKIE)?.value ?? null,
    userId: uid,
    activeSpaceId,
    organizationId: activeSpace?.organizationId ?? null,
  });
  const t = await getServerSpaceSettingsTranslator(locale);

  const [globalPlatformLocale, globalLogLevel, globalOrganizationSettingsFlag] =
    await Promise.all([
      getScopedRuntimeSettingValue(
        supabase,
        'global',
        null,
        RUNTIME_SETTING_KEYS.platformLocale
      ),
      getScopedRuntimeSettingValue(
        supabase,
        'global',
        null,
        RUNTIME_SETTING_KEYS.runtimeLogLevel
      ),
      getScopedRuntimeSettingValue(
        supabase,
        'global',
        null,
        RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
      ),
    ]);
  const localeOptions = getSpaceSettingsLocaleOptions(t);
  const logLevelOptions = runtimeLogLevelValues.map((value) => ({
    value,
    label: resolveLogLevelLabel(value, t),
  }));

  const [rolesResult, permissionResult, organizationsResult, spacesResult] =
    await Promise.all([
      listGlobalSystemRolesAction(),
      supabase
        .from('permissions')
        .select('key')
        .order('key', { ascending: true }),
      supabase.from('organizations').select('id,name,slug').order('name'),
      supabase
        .from('spaces')
        .select('id,name,slug,organization_id')
        .order('name', { ascending: true }),
    ]);

  const globalRoles: PlatformRoleCatalogRow[] = rolesResult.ok
    ? rolesResult.roles
    : [];
  const globalRolesError = rolesResult.ok ? null : rolesResult.message;
  const permissionCatalogKeys = (permissionResult.data ?? [])
    .map((row) => row.key)
    .filter((key): key is string => Boolean(key));
  const permissionCatalogError = permissionResult.error
    ? t('superAdmin.globalRoles.errors.loadPermissions')
    : null;

  const organizations = organizationsResult.data ?? [];
  const spacesByOrg = new Map<
    string,
    Array<{ id: string; name: string; slug: string }>
  >();
  for (const row of spacesResult.data ?? []) {
    const current = spacesByOrg.get(row.organization_id) ?? [];
    current.push({ id: row.id, name: row.name, slug: row.slug });
    spacesByOrg.set(row.organization_id, current);
  }
  for (const [, spaces] of spacesByOrg) {
    spaces.sort((left, right) => left.name.localeCompare(right.name));
  }

  const activeOrganization = activeSpace
    ? (organizations.find((org) => org.id === activeSpace.organizationId) ??
      null)
    : null;
  const platformSuperAdminsResult = await listPlatformSuperAdmins();

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('superAdmin.title')}
        </h1>
        <p className="text-muted-foreground text-sm">
          {t('superAdmin.subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('superAdmin.boundary.title')}</CardTitle>
          <CardDescription>
            {t('superAdmin.boundary.description')}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('runtimeSettings.platformLocale.title.global')}
          </CardTitle>
          <CardDescription>
            {t('runtimeSettings.platformLocale.description.global')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuntimeSettingSelectForm
            currentValue={resolveScopedPlatformLocaleValue(
              globalPlatformLocale,
              {
                source: 'global scope',
              }
            )}
            fieldLabel={t('runtimeSettings.platformLocale.fieldLabel')}
            revalidatePath="/ops"
            scope="global"
            scopeId={null}
            settingKey={RUNTIME_SETTING_KEYS.platformLocale}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
            options={localeOptions}
            testId="global-platform-locale"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('runtimeSettings.runtimeLogLevel.title')}</CardTitle>
          <CardDescription>
            {t('runtimeSettings.runtimeLogLevel.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuntimeSettingSelectForm
            currentValue={
              typeof globalLogLevel === 'string'
                ? globalLogLevel
                : String(
                    getDefaultRuntimeSettingValue(
                      RUNTIME_SETTING_KEYS.runtimeLogLevel
                    )
                  )
            }
            fieldLabel={t('runtimeSettings.runtimeLogLevel.fieldLabel')}
            revalidatePath="/ops"
            scope="global"
            scopeId={null}
            settingKey={RUNTIME_SETTING_KEYS.runtimeLogLevel}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
            options={logLevelOptions}
            testId="global-runtime-log-level"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('runtimeSettings.featureFlags.title')}</CardTitle>
          <CardDescription>
            {t('runtimeSettings.featureFlags.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeatureFlagCheckboxForm
            currentValue={
              typeof globalOrganizationSettingsFlag === 'boolean'
                ? globalOrganizationSettingsFlag
                : defaultPlatformFeatureFlags[
                    PLATFORM_FEATURE_FLAG_KEYS.organizationSettings
                  ]
            }
            description={t(
              'runtimeSettings.featureFlags.organizationSettings.description'
            )}
            fieldLabel={t(
              'runtimeSettings.featureFlags.organizationSettings.label'
            )}
            featureKey={
              RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
            }
            revalidatePath="/ops"
            scope="global"
            scopeId={null}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
            testId="global-platform-feature-flag-organization-settings"
          />
        </CardContent>
      </Card>

      <PlatformSuperAdminClient
        superAdmins={platformSuperAdminsResult.superAdmins}
        activeCount={platformSuperAdminsResult.activeCount}
        maxActiveCount={platformSuperAdminsResult.maxActiveCount}
        locale={locale}
        loadError={
          platformSuperAdminsResult.ok
            ? null
            : platformSuperAdminsResult.message
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('superAdmin.currentContext.title')}</CardTitle>
          <CardDescription>
            {t('superAdmin.currentContext.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {activeSpace ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{activeSpace.name}</span>
                <Badge variant="secondary">
                  {t('superAdmin.currentContext.active')}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {t('superAdmin.currentContext.spaceSlug', {
                  slug: activeSpace.slug,
                })}
              </p>
              {activeOrganization ? (
                <p className="text-muted-foreground text-sm">
                  {t('superAdmin.currentContext.organizationSlug', {
                    slug: activeOrganization.slug,
                  })}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/space-settings">
                    {t('superAdmin.currentContext.openSpaceSettings')}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/organizations">
                    {t('superAdmin.currentContext.openOrganizations')}
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.currentContext.empty')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('superAdmin.support.title')}</CardTitle>
          <CardDescription>
            {t('superAdmin.support.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.support.emptyOrganizations')}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {organizations.map((organization) => {
                const orgSpaces = spacesByOrg.get(organization.id) ?? [];
                return (
                  <Card key={organization.id} size="sm">
                    <CardHeader className="flex flex-row items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <CardTitle>{organization.name}</CardTitle>
                        <CardDescription>{organization.slug}</CardDescription>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/organizations/${organization.id}/settings`}
                        >
                          {t('superAdmin.support.openOrganizationSettings')}
                        </Link>
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {orgSpaces.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          {t('superAdmin.support.emptySpaces')}
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-3">
                          {orgSpaces.map((space) => {
                            const isCurrent = activeSpaceId === space.id;
                            return (
                              <li
                                key={space.id}
                                className="border-border flex items-center justify-between gap-3 rounded-md border p-3"
                              >
                                <div className="flex min-w-0 flex-col gap-1">
                                  <span className="font-medium">
                                    {space.name}
                                  </span>
                                  <span className="text-muted-foreground text-xs">
                                    {space.slug}
                                  </span>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {isCurrent ? (
                                    <Badge variant="secondary">
                                      {t('superAdmin.support.currentBadge')}
                                    </Badge>
                                  ) : null}
                                  <SupportSpaceActivateButton
                                    spaceId={space.id}
                                    label={t(
                                      'superAdmin.support.openSpaceSettings'
                                    )}
                                  />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('superAdmin.globalRoles.title')}</CardTitle>
          <CardDescription>
            {t('superAdmin.globalRoles.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {globalRolesError ? (
            <p className="text-destructive text-sm" role="alert">
              {globalRolesError}
            </p>
          ) : null}
          {permissionCatalogError ? (
            <p className="text-destructive text-sm" role="alert">
              {permissionCatalogError}
            </p>
          ) : null}
          <GlobalSystemRoleCatalogClient
            roles={globalRoles}
            permissionCatalogKeys={permissionCatalogKeys}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function OperatorConsolePage() {
  return (
    <Suspense fallback={<OperatorConsoleFallback />}>
      <OperatorConsoleContent />
    </Suspense>
  );
}
