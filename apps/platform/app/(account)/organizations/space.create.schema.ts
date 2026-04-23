import { z } from 'zod';

import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.i18n';

export type SpaceCreateFormValues = {
  organizationId: string;
  name: string;
  slug: string;
};

export function createSpaceCreateSchema(t: SpaceSettingsTranslator) {
  return z.object({
    organizationId: z
      .string()
      .min(1, t('spaceCreate.validation.organizationRequired')),
    name: z.string().min(1, t('spaceCreate.validation.nameRequired')).max(200),
    slug: z
      .string()
      .min(2, t('spaceCreate.validation.slugTooShort'))
      .max(80)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        t('spaceCreate.validation.slugFormat')
      ),
  });
}
