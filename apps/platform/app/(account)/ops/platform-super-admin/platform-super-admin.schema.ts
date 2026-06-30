import { z } from 'zod';

import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';

export type Translator = ReturnType<typeof getSpaceSettingsTranslator>;

export type PlatformSuperAdminLocale = SpaceSettingsLocale;

export function createPlatformSuperAdminGrantSchema(t: Translator) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t('superAdmin.platformAdmins.grant.validation.emailRequired'))
      .max(254, t('superAdmin.platformAdmins.grant.validation.emailTooLong'))
      .email(t('superAdmin.platformAdmins.grant.validation.emailInvalid')),
    reason: z
      .string()
      .trim()
      .min(1, t('superAdmin.platformAdmins.grant.validation.reasonRequired'))
      .max(400, t('superAdmin.platformAdmins.grant.validation.reasonTooLong')),
  });
}

export function createPlatformSuperAdminRevokeSchema(t: Translator) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(1, t('superAdmin.platformAdmins.revoke.validation.reasonRequired'))
      .max(400, t('superAdmin.platformAdmins.revoke.validation.reasonTooLong')),
  });
}
