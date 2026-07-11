import { RUNTIME_SETTING_KEYS } from '@workspace/settings-runtime';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { RuntimeSettingSelectForm } from '@/components/runtime-setting-select-form';
import type { OrganizationSettingsTranslator } from '@/app/(account)/organizations/[organizationId]/settings/organization-settings.helpers';

type LocaleOption = { label: string; value: string };

export function OrganizationLocaleSection({
  organizationId,
  organizationName,
  organizationSlug,
  organizationFeatureEnabled,
  currentValue,
  localeOptions,
  t,
}: {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationFeatureEnabled: boolean;
  currentValue: string;
  localeOptions: LocaleOption[];
  t: OrganizationSettingsTranslator;
}) {
  if (!organizationFeatureEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('organizationSettings.locked.title')}</CardTitle>
          <CardDescription>
            {t('organizationSettings.locked.description')}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{organizationName}</CardTitle>
        <CardDescription>
          {t('organizations.slug', { slug: organizationSlug })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeSettingSelectForm
          allowInherit
          currentValue={currentValue}
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
  );
}
