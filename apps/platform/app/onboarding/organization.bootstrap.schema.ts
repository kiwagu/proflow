import { z } from 'zod';

export const organizationBootstrapSchema = z.object({
  orgName: z.string().min(1, 'Organization name is required.'),
  orgSlug: z
    .string()
    .min(2)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers, and hyphens only.'
    ),
  spaceName: z.string().min(1, 'Space name is required.'),
  spaceSlug: z
    .string()
    .min(2)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers, and hyphens only.'
    ),
});

export type OrganizationBootstrapValues = z.infer<
  typeof organizationBootstrapSchema
>;
