import { z } from 'zod';

const customRoleKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Role key is too short.')
  .max(64, 'Role key is too long.')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Role key must start with a letter and contain only lowercase letters, numbers, and underscores.'
  )
  .refine(
    (value) => !['member', 'space_admin', 'org_admin'].includes(value),
    'Reserved role key cannot be used for custom roles.'
  );

const permissionKeySchema = z
  .string()
  .trim()
  .min(1, 'Permission key is required.');

const entityIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9]{1,15}_[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{16}\.[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{10}$/,
    'Invalid entity id.'
  );

export const createCustomRoleSchema = z
  .object({
    organizationId: entityIdSchema,
    key: customRoleKeySchema,
    label: z.string().trim().min(1, 'Role label is required.').max(120),
    description: z.string().trim().max(400).optional().default(''),
    scope: z.enum(['space', 'organization']).default('space'),
    permissionKeys: z
      .array(permissionKeySchema)
      .min(1, 'Select at least one permission.'),
  })
  .strict();

export const updateCustomRoleSchema = z
  .object({
    roleId: entityIdSchema,
    key: customRoleKeySchema.optional(),
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional(),
    permissionKeys: z
      .array(permissionKeySchema)
      .min(1, 'Select at least one permission.'),
  })
  .strict();

export const archiveCustomRoleSchema = z
  .object({
    roleId: entityIdSchema,
  })
  .strict();

const systemRoleKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Role key is too short.')
  .max(64, 'Role key is too long.')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Role key must start with a letter and contain only lowercase letters, numbers, and underscores.'
  );

const confirmationSchema = z
  .boolean()
  .refine((value) => value === true, 'Explicit confirmation is required.');

export const createGlobalSystemRoleSchema = z
  .object({
    key: systemRoleKeySchema,
    label: z.string().trim().min(1, 'Role label is required.').max(120),
    description: z.string().trim().max(400).optional().default(''),
    permissionKeys: z
      .array(permissionKeySchema)
      .min(1, 'Select at least one permission.'),
    confirmed: confirmationSchema,
  })
  .strict();

export const updateGlobalSystemRoleSchema = z
  .object({
    roleId: entityIdSchema,
    key: systemRoleKeySchema.optional(),
    label: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(400).optional(),
    permissionKeys: z
      .array(permissionKeySchema)
      .min(1, 'Select at least one permission.'),
    confirmed: confirmationSchema,
  })
  .strict();

export const archiveGlobalSystemRoleSchema = z
  .object({
    roleId: entityIdSchema,
    confirmed: confirmationSchema,
  })
  .strict();
