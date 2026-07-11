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
import { Button } from '@workspace/ui/components/button';
import { Skeleton } from '@workspace/ui/components/skeleton';

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
import { buildSpaceBooleanSettingMap } from '@/app/(account)/organizations/[organizationId]/settings/organization-settings.helpers';
import {
  OrganizationAvatarSection,
  OrganizationEntitlementsSection,
  OrganizationFeatureRolloutSection,
  OrganizationLocaleSection,
  OrganizationMediaUploadLimitSection,
} from '@/app/(account)/organizations/[organizationId]/settings/sections';
import { cookies, headers } from 'next/headers';

function OrganizationSettingsFallback() {
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <Skeleton className="bg-muted/50 h-48 w-full rounded-xl" />
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
    mediaMaxUploadValue,
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
    getScopedRuntimeSettingValue(
      supabase,
      'organization',
      organizationId,
      RUNTIME_SETTING_KEYS.mediaMaxUploadBytes
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
  const mediaMaxUploadBytes =
    typeof mediaMaxUploadValue === 'number' ? mediaMaxUploadValue : null;
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

  const spaceFeatureValues = buildSpaceBooleanSettingMap(
    spaceFeatureSettings.data
  );

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

  const spaceAdvancedStructuralViewValues = buildSpaceBooleanSettingMap(
    spaceAdvancedStructuralViewSettings.data
  );

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

      <OrganizationAvatarSection
        organizationId={organizationRow.id}
        organizationName={organizationRow.name}
        organizationSlug={organizationRow.slug}
        avatarUrl={organizationRow.avatar_url ?? null}
        t={t}
      />

      <OrganizationFeatureRolloutSection
        organizationId={organizationId}
        organizationFeatureEnabled={organizationFeatureEnabled}
        spaces={spaces}
        spaceFeatureValues={spaceFeatureValues}
        t={t}
      />

      <OrganizationEntitlementsSection
        organizationId={organizationId}
        advancedStructuralViewEnabled={advancedStructuralViewEnabled}
        spaces={spaces}
        spaceAdvancedStructuralViewValues={spaceAdvancedStructuralViewValues}
        t={t}
      />

      <OrganizationMediaUploadLimitSection
        organizationId={organizationId}
        currentBytes={mediaMaxUploadBytes}
        t={t}
      />

      <OrganizationLocaleSection
        organizationId={organizationId}
        organizationName={organizationRow.name}
        organizationSlug={organizationRow.slug}
        organizationFeatureEnabled={organizationFeatureEnabled}
        currentValue={resolveScopedPlatformLocaleValue(scopedLocale, {
          allowInherit: true,
          source: 'organization scope',
        })}
        localeOptions={localeOptions}
        t={t}
      />
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
