import { z } from 'zod';

export const spaceInviteCreateSchema = z
  .object({
    spaceId: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9]{1,15}_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{16}\.[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10}$/,
        'Invalid space id.'
      ),
    email: z
      .string()
      .trim()
      .min(1, 'Email is required.')
      .email('Enter a valid email.'),
    roleKey: z.string().trim().min(1, 'Role is required.'),
  })
  .strict();

export type SpaceInviteCreateFormValues = z.infer<
  typeof spaceInviteCreateSchema
>;
