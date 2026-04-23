import { z } from 'zod';

export const profileSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, 'Email must be at most 254 characters.')
    .refine(
      (value) => value.length === 0 || z.email().safeParse(value).success,
      {
        message: 'Enter a valid email address.',
      }
    ),
  display_name: z
    .string()
    .trim()
    .max(80, 'Display name must be at most 80 characters.'),
  avatar_url: z
    .string()
    .trim()
    .max(2000, 'URL is too long.')
    .refine((value) => value.length === 0 || /^https?:\/\//.test(value), {
      message: 'Use a valid URL starting with http:// or https://',
    }),
  bio: z.string().trim().max(500, 'Bio must be at most 500 characters.'),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
