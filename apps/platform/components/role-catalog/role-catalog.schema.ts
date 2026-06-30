import { z } from 'zod';

import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';

export type Translator = ReturnType<typeof getSpaceSettingsTranslator>;

export type RoleCatalogLocale = SpaceSettingsLocale;

export function createRoleFormSchema(t: Translator) {
  return z.object({
    key: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, t('roleCatalog.validation.roleKeyTooShort'))
      .max(64, t('roleCatalog.validation.roleKeyTooLong'))
      .regex(/^[a-z][a-z0-9_]*$/, t('roleCatalog.validation.roleKeyFormat')),
    label: z
      .string()
      .trim()
      .min(1, t('roleCatalog.validation.roleLabelRequired'))
      .max(120),
    description: z.string().trim().max(400),
    permissionKeys: z
      .array(
        z.string().trim().min(1, t('roleCatalog.validation.permissionRequired'))
      )
      .min(1, t('roleCatalog.validation.permissionMinOne')),
  });
}

export type RoleFormSchema = ReturnType<typeof createRoleFormSchema>;

export type RoleDraft = z.infer<RoleFormSchema>;
