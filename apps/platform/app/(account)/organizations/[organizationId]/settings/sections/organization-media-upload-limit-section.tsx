import {
  MEDIA_MAX_UPLOAD_DEFAULT_BYTES,
  MEDIA_MAX_UPLOAD_HARD_CAP_BYTES,
  RUNTIME_SETTING_KEYS,
} from '@workspace/settings-runtime';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { RuntimeSettingNumberForm } from '@/components/runtime-setting-number-form';
import type { OrganizationSettingsTranslator } from '@/app/(account)/organizations/[organizationId]/settings/organization-settings.helpers';

export function OrganizationMediaUploadLimitSection({
  organizationId,
  currentBytes,
  t,
}: {
  organizationId: string;
  currentBytes: number | null;
  t: OrganizationSettingsTranslator;
}) {
  // Resolve the message copy to STRINGS here (server) — the client form cannot receive
  // function props. The interpolated values are fixed constants (the 5 GB hard cap, the
  // 200 MB default), derived from the same byte constants the form uses for its bounds.
  const bytesPerMegabyte = 1024 * 1024;
  const hardCapMegabytes = Math.round(
    MEDIA_MAX_UPLOAD_HARD_CAP_BYTES / bytesPerMegabyte
  );
  const defaultMegabytes = Math.round(
    MEDIA_MAX_UPLOAD_DEFAULT_BYTES / bytesPerMegabyte
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('organizationSettings.mediaUploadLimit.title')}
        </CardTitle>
        <CardDescription>
          {t('organizationSettings.mediaUploadLimit.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuntimeSettingNumberForm
          currentBytes={currentBytes}
          defaultBytes={MEDIA_MAX_UPLOAD_DEFAULT_BYTES}
          hardCapBytes={MEDIA_MAX_UPLOAD_HARD_CAP_BYTES}
          description={t('runtimeSettings.mediaMaxUpload.description')}
          fieldLabel={t('runtimeSettings.mediaMaxUpload.fieldLabel')}
          unitLabel={t('runtimeSettings.mediaMaxUpload.unit')}
          overCapMessage={t('runtimeSettings.mediaMaxUpload.overCap', {
            max: hardCapMegabytes,
          })}
          invalidMessage={t('runtimeSettings.mediaMaxUpload.invalid')}
          defaultHint={t('runtimeSettings.mediaMaxUpload.defaultHint', {
            default: defaultMegabytes,
          })}
          revalidatePath={`/organizations/${organizationId}/settings`}
          scope="organization"
          scopeId={organizationId}
          settingKey={RUNTIME_SETTING_KEYS.mediaMaxUploadBytes}
          submitLabel={t('runtimeSettings.actions.save')}
          successMessage={t('runtimeSettings.messages.saved')}
          testId="organization-media-max-upload-bytes"
        />
      </CardContent>
    </Card>
  );
}
