import { connection } from 'next/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import {
  PLATFORM_LOCALE_COOKIE,
  defaultPlatformFeatureFlags,
  defaultPlatformEntitlements,
  PLATFORM_FEATURE_FLAG_KEYS,
  PLATFORM_ENTITLEMENT_KEYS,
  RUNTIME_SETTING_KEYS,
} from '@workspace/settings-runtime';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { FeatureFlagCheckboxForm } from '@/components/feature-flag-checkbox-form';
import { RuntimeSettingSelectForm } from '@/components/runtime-setting-select-form';
import { OrganizationAvatarForm } from '@/app/(account)/organizations/[organizationId]/settings/organization-avatar-form';
import {
  getSpaceSettingsLocaleOptions,
  getServerSpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.i18n';
import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { getIsSuperAdminForUser } from '@/lib/platform-nav-roles';
import {
  getScopedRuntimeSettingValue,
  resolveScopedPlatformLocaleValue,
  resolvePlatformLocaleForSession,
} from '@/lib/runtime-settings.server';
import { createClient } from '@/lib/supabase/server';
import { cookies, headers } from 'next/headers';

function OrganizationSettingsFallback() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="bg-muted/50 h-48 w-full animate-pulse rounded-xl" />
    </div>
  );
}

async function OrganizationSettingsContent({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await connection();
  const { organizationId } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    redirect('/auth/login');
  }

  const uid = userData.user.id;
  const { data: organizationRow } = await supabase
    .from('organizations')
    .select('id,name,slug,avatar_url')
    .eq('id', organizationId)
    .maybeSingle();

  if (!organizationRow) {
    redirect('/organizations');
  }

  const [
    isSuperAdmin,
    isOrgAdmin,
    locale,
    scopedLocale,
    organizationFeatureValue,
    advancedStructuralViewValue,
    spacesResult,
  ] = await Promise.all([
    getIsSuperAdminForUser(supabase, uid),
    getIsOrgAdminForOrganization(supabase, uid, organizationId),
    resolvePlatformLocaleForSession(supabase, {
      acceptLanguage: (await headers()).get('accept-language'),
      localeCookie:
        (await cookies()).get(PLATFORM_LOCALE_COOKIE)?.value ?? null,
      userId: uid,
      organizationId,
    }),
    getScopedRuntimeSettingValue(
      supabase,
      'organization',
      organizationId,
      RUNTIME_SETTING_KEYS.platformLocale
    ),
    getScopedRuntimeSettingValue(
      supabase,
      'organization',
      organizationId,
      RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
    ),
    getScopedRuntimeSettingValue(
      supabase,
      'organization',
      organizationId,
      RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView
    ),
    supabase
      .from('spaces')
      .select('id,name,slug')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
  ]);

  if (!isSuperAdmin && !isOrgAdmin) {
    redirect('/organizations');
  }

  const t = await getServerSpaceSettingsTranslator(locale);
  const localeOptions = getSpaceSettingsLocaleOptions(t);
  const organizationFeatureEnabled =
    typeof organizationFeatureValue === 'boolean'
      ? organizationFeatureValue
      : defaultPlatformFeatureFlags[
          PLATFORM_FEATURE_FLAG_KEYS.organizationSettings
        ];
  const advancedStructuralViewEnabled =
    typeof advancedStructuralViewValue === 'boolean'
      ? advancedStructuralViewValue
      : defaultPlatformEntitlements[
          PLATFORM_ENTITLEMENT_KEYS.advancedStructuralView
        ];
  const spaces = spacesResult.data ?? [];
  const spaceIds = spaces.map((space) => space.id);
  const spaceFeatureSettings =
    spaceIds.length > 0
      ? await supabase
          .from('runtime_settings')
          .select('scope_id,value')
          .eq('scope', 'space')
          .eq(
            'key',
            RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
          )
          .in('scope_id', spaceIds)
      : { data: [], error: null };

  const spaceFeatureValues = new Map<string, boolean>();
  for (const row of spaceFeatureSettings.data ?? []) {
    if (typeof row.scope_id === 'string' && typeof row.value === 'boolean') {
      spaceFeatureValues.set(row.scope_id, row.value);
    }
  }

  const spaceAdvancedStructuralViewSettings =
    spaceIds.length > 0
      ? await supabase
          .from('runtime_settings')
          .select('scope_id,value')
          .eq('scope', 'space')
          .eq(
            'key',
            RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView
          )
          .in('scope_id', spaceIds)
      : { data: [], error: null };

  const spaceAdvancedStructuralViewValues = new Map<string, boolean>();
  for (const row of spaceAdvancedStructuralViewSettings.data ?? []) {
    if (typeof row.scope_id === 'string' && typeof row.value === 'boolean') {
      spaceAdvancedStructuralViewValues.set(row.scope_id, row.value);
    }
  }

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/organizations">
              {t('organizationSettings.backToOrganizations')}
            </Link>
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('organizationSettings.title')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('organizationSettings.subtitle', { name: organizationRow.name })}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{organizationRow.name}</CardTitle>
          <CardDescription>
            {t('organizations.slug', { slug: organizationRow.slug })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium">
                {t('organizationSettings.avatar.title')}
              </p>
              <p className="text-muted-foreground text-sm">
                {t('organizationSettings.avatar.description')}
              </p>
            </div>
            <OrganizationAvatarForm
              organizationId={organizationRow.id}
              currentValue={organizationRow.avatar_url ?? null}
              submitLabel={t('runtimeSettings.actions.save')}
              successMessage={t('runtimeSettings.messages.saved')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('organizationSettings.featureRollout.title')}
          </CardTitle>
          <CardDescription>
            {t('organizationSettings.featureRollout.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <Badge
              variant={organizationFeatureEnabled ? 'default' : 'secondary'}
            >
              {organizationFeatureEnabled
                ? t('organizationSettings.featureRollout.status.enabled')
                : t('organizationSettings.featureRollout.status.disabled')}
            </Badge>
          </div>

          <FeatureFlagCheckboxForm
            currentValue={organizationFeatureEnabled}
            description={t(
              'organizationSettings.featureRollout.organizationGateDescription'
            )}
            fieldLabel={t(
              'organizationSettings.featureRollout.organizationGateLabel'
            )}
            featureKey={
              RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
            }
            revalidatePath={`/organizations/${organizationId}/settings`}
            scope="organization"
            scopeId={organizationId}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
            testId="organization-feature-flag-organization-settings"
          />

          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">
              {t('organizationSettings.featureRollout.spaceListTitle')}
            </p>

            {spaces.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('organizations.emptySpaces')}
              </p>
            ) : (
              spaces.map((space) => {
                const spaceEnabled = spaceFeatureValues.get(space.id) ?? false;
                const statusLabel = organizationFeatureEnabled
                  ? spaceEnabled
                    ? t('organizationSettings.featureRollout.status.enabled')
                    : t('organizationSettings.featureRollout.status.disabled')
                  : t(
                      'organizationSettings.featureRollout.status.disabledByOrganization'
                    );

                return (
                  <div
                    key={space.id}
                    className="border-border flex flex-col gap-4 rounded-md border p-4"
                    data-testid={`organization-feature-flag-space-card-${space.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{space.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {space.slug}
                        </p>
                      </div>
                      <Badge
                        variant={
                          organizationFeatureEnabled && spaceEnabled
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {statusLabel}
                      </Badge>
                    </div>

                    <FeatureFlagCheckboxForm
                      currentValue={spaceEnabled}
                      description={t(
                        'organizationSettings.featureRollout.spaceDescription',
                        {
                          slug: space.slug,
                          status: statusLabel,
                        }
                      )}
                      fieldLabel={space.name}
                      featureKey={
                        RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
                      }
                      revalidatePath={`/organizations/${organizationId}/settings`}
                      scope="space"
                      scopeId={space.id}
                      submitLabel={t('runtimeSettings.actions.save')}
                      successMessage={t('runtimeSettings.messages.saved')}
                      testId={`organization-feature-flag-space-${space.id}`}
                    />
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('organizationSettings.entitlements.title')}</CardTitle>
          <CardDescription>
            {t('organizationSettings.entitlements.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <Badge
              variant={advancedStructuralViewEnabled ? 'default' : 'secondary'}
            >
              {advancedStructuralViewEnabled
                ? t('organizationSettings.featureRollout.status.enabled')
                : t('organizationSettings.featureRollout.status.disabled')}
            </Badge>
          </div>

          <FeatureFlagCheckboxForm
            currentValue={advancedStructuralViewEnabled}
            description={t(
              'organizationSettings.entitlements.advancedStructuralView.description'
            )}
            fieldLabel={t(
              'organizationSettings.entitlements.advancedStructuralView.label'
            )}
            featureKey={
              RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView
            }
            revalidatePath={`/organizations/${organizationId}/settings`}
            scope="organization"
            scopeId={organizationId}
            submitLabel={t('runtimeSettings.actions.save')}
            successMessage={t('runtimeSettings.messages.saved')}
            testId="organization-entitlement-advanced-structural-view"
          />

          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">
              {t('organizationSettings.featureRollout.spaceListTitle')}
            </p>

            {spaces.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('organizations.emptySpaces')}
              </p>
            ) : (
              spaces.map((space) => {
                const spaceEntitled =
                  spaceAdvancedStructuralViewValues.get(space.id) ?? false;
                const statusLabel = advancedStructuralViewEnabled
                  ? spaceEntitled
                    ? t('organizationSettings.featureRollout.status.enabled')
                    : t('organizationSettings.featureRollout.status.disabled')
                  : t(
                      'organizationSettings.featureRollout.status.disabledByOrganization'
                    );

                return (
                  <div
                    key={space.id}
                    className="border-border flex flex-col gap-4 rounded-md border p-4"
                    data-testid={`organization-entitlement-advanced-structural-view-space-card-${space.id}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{space.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {space.slug}
                        </p>
                      </div>
                      <Badge
                        variant={
                          advancedStructuralViewEnabled && spaceEntitled
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {statusLabel}
                      </Badge>
                    </div>

                    <FeatureFlagCheckboxForm
                      currentValue={spaceEntitled}
                      description={t(
                        'organizationSettings.featureRollout.spaceDescription',
                        {
                          slug: space.slug,
                          status: statusLabel,
                        }
                      )}
                      fieldLabel={space.name}
                      featureKey={
                        RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView
                      }
                      revalidatePath={`/organizations/${organizationId}/settings`}
                      scope="space"
                      scopeId={space.id}
                      submitLabel={t('runtimeSettings.actions.save')}
                      successMessage={t('runtimeSettings.messages.saved')}
                      testId={`organization-entitlement-advanced-structural-view-space-${space.id}`}
                    />
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {organizationFeatureEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>{organizationRow.name}</CardTitle>
            <CardDescription>
              {t('organizations.slug', { slug: organizationRow.slug })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuntimeSettingSelectForm
              allowInherit
              currentValue={resolveScopedPlatformLocaleValue(scopedLocale, {
                allowInherit: true,
                source: 'organization scope',
              })}
              description={t(
                'runtimeSettings.platformLocale.description.organization'
              )}
              fieldLabel={t('runtimeSettings.platformLocale.fieldLabel')}
              inheritOptionLabel={t(
                'runtimeSettings.platformLocale.inherit.organization'
              )}
              revalidatePath={`/organizations/${organizationId}/settings`}
              scope="organization"
              scopeId={organizationId}
              settingKey={RUNTIME_SETTING_KEYS.platformLocale}
              submitLabel={t('runtimeSettings.actions.save')}
              successMessage={t('runtimeSettings.messages.saved')}
              options={localeOptions}
              testId="organization-platform-locale"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('organizationSettings.locked.title')}</CardTitle>
            <CardDescription>
              {t('organizationSettings.locked.description')}
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

export default function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  return (
    <Suspense fallback={<OrganizationSettingsFallback />}>
      <OrganizationSettingsContent params={params} />
    </Suspense>
  );
}
