import { z } from 'zod';

export const spaceInviteSetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(72, 'Password is too long.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type SpaceInviteSetPasswordValues = z.infer<
  typeof spaceInviteSetPasswordSchema
>;
