import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { RUNTIME_SETTING_KEYS } from '@workspace/settings-runtime';

import { RuntimeSettingSelectForm } from '@/components/runtime-setting-select-form';
import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.helpers';
import type { getSpaceSettingsLocaleOptions } from '@/app/(account)/space-settings/space-settings.i18n';

type LocaleOptions = ReturnType<typeof getSpaceSettingsLocaleOptions>;

export function SpaceRuntimeSettingsSection({
  spaceId,
  currentValue,
  localeOptions,
  t,
}: {
  spaceId: string;
  currentValue: string;
  localeOptions: LocaleOptions;
  t: SpaceSettingsTranslator;
}) {
  return (
    <Card data-testid={`space-language-card-${spaceId}`}>
      <CardHeader>
        <CardTitle>{t('runtimeSettings.platformLocale.title.space')}</CardTitle>
        <CardDescription>
          {t('runtimeSettings.platformLocale.description.space')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeSettingSelectForm
          allowInherit
          currentValue={currentValue}
          fieldLabel={t('runtimeSettings.platformLocale.fieldLabel')}
          inheritOptionLabel={t('runtimeSettings.platformLocale.inherit.space')}
          revalidatePath="/space-settings"
          scope="space"
          scopeId={spaceId}
          settingKey={RUNTIME_SETTING_KEYS.platformLocale}
          submitLabel={t('runtimeSettings.actions.save')}
          successMessage={t('runtimeSettings.messages.saved')}
          options={localeOptions}
          testId="space-platform-locale"
        />
      </CardContent>
    </Card>
  );
}
