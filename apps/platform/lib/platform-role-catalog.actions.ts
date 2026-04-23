'use server';

import { z } from 'zod';
import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';

import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { PLATFORM_OPERATOR_CONSOLE_PATH } from '@/lib/platform-routes';
import { revalidatePlatformPath } from '@/lib/platform-revalidate';
import { createClient } from '@/lib/supabase/server';

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

const createCustomRoleSchema = z
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

const updateCustomRoleSchema = z
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

const archiveCustomRoleSchema = z
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

const createGlobalSystemRoleSchema = z
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

const updateGlobalSystemRoleSchema = z
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

const archiveGlobalSystemRoleSchema = z
  .object({
    roleId: entityIdSchema,
    confirmed: confirmationSchema,
  })
  .strict();

export type PlatformRoleCatalogRow = Readonly<{
  id: string;
  key: string;
  label: string;
  description: string | null;
  scope: string;
  roleKind: string;
  ownerOrganizationId: string | null;
  isBaseline: boolean;
  isMutable: boolean;
  archivedAt: string | null;
  permissionKeys: string[];
}>;

export type ListOrganizationCustomRolesResult =
  | { ok: true; roles: PlatformRoleCatalogRow[] }
  | { ok: false; message: string };

export type RoleCatalogMutateResult =
  | { ok: true; roleId: string }
  | { ok: false; message: string };

function normalizePermissionKeys(permissionKeys: readonly string[]): string[] {
  return [
    ...new Set(permissionKeys.map((value) => value.trim()).filter(Boolean)),
  ];
}

function extractPermissionKey(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const key = Reflect.get(value, 'key');
    if (typeof key === 'string' && key.trim().length > 0) {
      return key.trim();
    }
    return null;
  }
  if (Array.isArray(value) && value.length > 0) {
    return extractPermissionKey(value[0]);
  }
  return null;
}

function parseRoleIdRpcResult(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

async function canManageOrganizationRoleCatalog(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const supabase = await createClient();
  const [isCriticalOverride, isOrgAdmin] = await Promise.all([
    hasCriticalCapability(
      supabase,
      CRITICAL_CAPABILITY_KEYS.platformAdminOverride
    ),
    getIsOrgAdminForOrganization(supabase, userId, organizationId),
  ]);

  return isCriticalOverride || isOrgAdmin;
}

async function canManageGlobalSystemRoleCatalog(): Promise<boolean> {
  const supabase = await createClient();
  return hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );
}

async function ensurePermissionIds(permissionKeys: readonly string[]): Promise<
  | {
      ok: true;
      permissionIds: string[];
      normalizedPermissionKeys: string[];
    }
  | {
      ok: false;
      message: string;
    }
> {
  const normalizedPermissionKeys = normalizePermissionKeys(permissionKeys);
  const supabase = await createClient();
  const { data: permissionRows, error: permissionErr } = await supabase
    .from('permissions')
    .select('id,key')
    .in('key', normalizedPermissionKeys);

  if (permissionErr) {
    return { ok: false, message: 'Could not validate permission catalog.' };
  }

  const keyToId = new Map<string, string>();
  for (const row of permissionRows ?? []) {
    keyToId.set(row.key, row.id);
  }

  const unknownKeys = normalizedPermissionKeys.filter(
    (key) => !keyToId.has(key)
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      message: `Unknown permission keys: ${unknownKeys.join(', ')}`,
    };
  }

  return {
    ok: true,
    normalizedPermissionKeys,
    permissionIds: normalizedPermissionKeys.map(
      (key) => keyToId.get(key) as string
    ),
  };
}

export async function listOrganizationCustomRolesAction(
  organizationId: string
): Promise<ListOrganizationCustomRolesResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  if (
    !(await canManageOrganizationRoleCatalog(organizationId, userData.user.id))
  ) {
    return {
      ok: false,
      message: 'Not allowed to read organization role catalog.',
    };
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from('roles')
    .select(
      'id,key,label,description,scope,role_kind,owner_organization_id,is_baseline,is_mutable,archived_at'
    )
    .eq('role_kind', 'custom')
    .eq('owner_organization_id', organizationId)
    .order('label', { ascending: true });

  if (roleErr) {
    return { ok: false, message: 'Could not load role catalog.' };
  }

  const roleIds = (roleRows ?? []).map((row) => row.id);
  const rolePermissionKeys = new Map<string, string[]>();

  if (roleIds.length > 0) {
    const { data: permissionRows } = await supabase
      .from('role_permission')
      .select(
        'role_id, permission:permissions!role_permission_permission_id_fkey(key)'
      )
      .in('role_id', roleIds);

    for (const row of permissionRows ?? []) {
      const permissionKey = extractPermissionKey(row.permission);
      if (!permissionKey) {
        continue;
      }
      const current = rolePermissionKeys.get(row.role_id) ?? [];
      current.push(permissionKey);
      rolePermissionKeys.set(row.role_id, current);
    }
  }

  const roles: PlatformRoleCatalogRow[] = (roleRows ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    scope: row.scope,
    roleKind: row.role_kind,
    ownerOrganizationId: row.owner_organization_id,
    isBaseline: row.is_baseline,
    isMutable: row.is_mutable,
    archivedAt: row.archived_at,
    permissionKeys: [...new Set(rolePermissionKeys.get(row.id) ?? [])].sort(),
  }));

  return { ok: true, roles };
}

export async function createOrganizationCustomRoleAction(
  values: z.input<typeof createCustomRoleSchema>
): Promise<RoleCatalogMutateResult> {
  const parsed = createCustomRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const { organizationId, key, label, description, scope, permissionKeys } =
    parsed.data;

  if (
    !(await canManageOrganizationRoleCatalog(organizationId, userData.user.id))
  ) {
    return {
      ok: false,
      message: 'Not allowed to manage this organization role catalog.',
    };
  }

  const permissionResolution = await ensurePermissionIds(permissionKeys);
  if (!permissionResolution.ok) {
    return { ok: false, message: permissionResolution.message };
  }

  const { data, error } = await supabase.rpc(
    'rpc_create_organization_custom_role',
    {
      p_organization_id: organizationId,
      p_key: key,
      p_label: label.trim(),
      p_description: description.trim(),
      p_scope: scope,
      p_permission_keys: permissionResolution.normalizedPermissionKeys,
    }
  );

  const roleId = parseRoleIdRpcResult(data);
  if (error || !roleId) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (error?.message ?? 'Could not create role.')
          : 'Could not create role.',
    };
  }

  revalidatePlatformPath('/organizations');
  revalidatePlatformPath('/space-settings');

  return { ok: true, roleId };
}

export async function updateOrganizationCustomRoleAction(
  values: z.input<typeof updateCustomRoleSchema>
): Promise<RoleCatalogMutateResult> {
  const parsed = updateCustomRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const { roleId, key, label, description, permissionKeys } = parsed.data;

  const { data: roleRow, error: roleErr } = await supabase
    .from('roles')
    .select('id,owner_organization_id,role_kind,is_baseline,archived_at')
    .eq('id', roleId)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { ok: false, message: 'Role not found.' };
  }

  if (roleRow.role_kind !== 'custom' || !roleRow.owner_organization_id) {
    return {
      ok: false,
      message: 'Only custom organization roles are editable.',
    };
  }

  if (roleRow.archived_at) {
    return { ok: false, message: 'Archived role cannot be edited.' };
  }

  if (
    !(await canManageOrganizationRoleCatalog(
      roleRow.owner_organization_id,
      userData.user.id
    ))
  ) {
    return { ok: false, message: 'Not allowed to edit this role.' };
  }

  const permissionResolution = await ensurePermissionIds(permissionKeys);
  if (!permissionResolution.ok) {
    return { ok: false, message: permissionResolution.message };
  }

  const { data, error } = await supabase.rpc(
    'rpc_update_organization_custom_role',
    {
      p_role_id: roleId,
      p_key: key ?? '',
      p_label: label?.trim() ?? '',
      p_description: typeof description === 'string' ? description.trim() : '',
      p_permission_keys: permissionResolution.normalizedPermissionKeys,
    }
  );

  const updatedRoleId = parseRoleIdRpcResult(data);
  if (error || !updatedRoleId) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (error?.message ?? 'Could not update role.')
          : 'Could not update role.',
    };
  }

  revalidatePlatformPath('/organizations');
  revalidatePlatformPath('/space-settings');

  return { ok: true, roleId: updatedRoleId };
}

export async function archiveOrganizationCustomRoleAction(
  values: z.input<typeof archiveCustomRoleSchema>
): Promise<RoleCatalogMutateResult> {
  const parsed = archiveCustomRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  const roleId = parsed.data.roleId;

  const { data: roleRow, error: roleErr } = await supabase
    .from('roles')
    .select('id,owner_organization_id,role_kind,archived_at')
    .eq('id', roleId)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { ok: false, message: 'Role not found.' };
  }

  if (roleRow.role_kind !== 'custom' || !roleRow.owner_organization_id) {
    return {
      ok: false,
      message: 'Only custom organization roles can be archived.',
    };
  }

  if (
    !(await canManageOrganizationRoleCatalog(
      roleRow.owner_organization_id,
      userData.user.id
    ))
  ) {
    return { ok: false, message: 'Not allowed to archive this role.' };
  }

  const { data, error } = await supabase.rpc(
    'rpc_archive_organization_custom_role',
    {
      p_role_id: roleId,
    }
  );

  const archivedRoleId = parseRoleIdRpcResult(data);
  if (error || !archivedRoleId) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (error?.message ?? 'Could not archive role.')
          : 'Could not archive role.',
    };
  }

  revalidatePlatformPath('/organizations');
  revalidatePlatformPath('/space-settings');

  return { ok: true, roleId: archivedRoleId };
}

export type ListGlobalSystemRolesResult =
  | { ok: true; roles: PlatformRoleCatalogRow[] }
  | { ok: false; message: string };

export async function listGlobalSystemRolesAction(): Promise<ListGlobalSystemRolesResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  if (!(await canManageGlobalSystemRoleCatalog())) {
    return {
      ok: false,
      message: 'Not allowed to read global system role catalog.',
    };
  }

  const { data: roleRows, error: roleErr } = await supabase
    .from('roles')
    .select(
      'id,key,label,description,scope,role_kind,owner_organization_id,is_baseline,is_mutable,archived_at'
    )
    .eq('role_kind', 'system')
    .eq('scope', 'global')
    .is('owner_organization_id', null)
    .order('label', { ascending: true });

  if (roleErr) {
    return { ok: false, message: 'Could not load global system roles.' };
  }

  const roleIds = (roleRows ?? []).map((row) => row.id);
  const rolePermissionKeys = new Map<string, string[]>();

  if (roleIds.length > 0) {
    const { data: permissionRows } = await supabase
      .from('role_permission')
      .select(
        'role_id, permission:permissions!role_permission_permission_id_fkey(key)'
      )
      .in('role_id', roleIds);

    for (const row of permissionRows ?? []) {
      const permissionKey = extractPermissionKey(row.permission);
      if (!permissionKey) {
        continue;
      }
      const current = rolePermissionKeys.get(row.role_id) ?? [];
      current.push(permissionKey);
      rolePermissionKeys.set(row.role_id, current);
    }
  }

  const roles: PlatformRoleCatalogRow[] = (roleRows ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    scope: row.scope,
    roleKind: row.role_kind,
    ownerOrganizationId: row.owner_organization_id,
    isBaseline: row.is_baseline,
    isMutable: row.is_mutable,
    archivedAt: row.archived_at,
    permissionKeys: [...new Set(rolePermissionKeys.get(row.id) ?? [])].sort(),
  }));

  return { ok: true, roles };
}

export async function createGlobalSystemRoleAction(
  values: z.input<typeof createGlobalSystemRoleSchema>
): Promise<RoleCatalogMutateResult> {
  const parsed = createGlobalSystemRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  if (!(await canManageGlobalSystemRoleCatalog())) {
    return {
      ok: false,
      message: 'Not allowed to manage global system roles.',
    };
  }

  const permissionResolution = await ensurePermissionIds(
    parsed.data.permissionKeys
  );
  if (!permissionResolution.ok) {
    return { ok: false, message: permissionResolution.message };
  }

  const { data, error } = await supabase.rpc('rpc_create_global_system_role', {
    p_key: parsed.data.key,
    p_label: parsed.data.label.trim(),
    p_description: parsed.data.description.trim(),
    p_permission_keys: permissionResolution.normalizedPermissionKeys,
  });

  const roleId = parseRoleIdRpcResult(data);
  if (error || !roleId) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (error?.message ?? 'Could not create global system role.')
          : 'Could not create global system role.',
    };
  }

  revalidatePlatformPath(PLATFORM_OPERATOR_CONSOLE_PATH);

  return { ok: true, roleId };
}

export async function updateGlobalSystemRoleAction(
  values: z.input<typeof updateGlobalSystemRoleSchema>
): Promise<RoleCatalogMutateResult> {
  const parsed = updateGlobalSystemRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  if (!(await canManageGlobalSystemRoleCatalog())) {
    return {
      ok: false,
      message: 'Not allowed to manage global system roles.',
    };
  }

  const { roleId, key, label, description, permissionKeys } = parsed.data;
  const { data: roleRow, error: roleErr } = await supabase
    .from('roles')
    .select('id,scope,role_kind,owner_organization_id,is_baseline,archived_at')
    .eq('id', roleId)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { ok: false, message: 'Role not found.' };
  }

  if (
    roleRow.role_kind !== 'system' ||
    roleRow.scope !== 'global' ||
    roleRow.owner_organization_id !== null ||
    roleRow.is_baseline
  ) {
    return {
      ok: false,
      message: 'Only non-baseline global system roles are editable.',
    };
  }

  if (roleRow.archived_at) {
    return { ok: false, message: 'Archived role cannot be edited.' };
  }

  const permissionResolution = await ensurePermissionIds(permissionKeys);
  if (!permissionResolution.ok) {
    return { ok: false, message: permissionResolution.message };
  }

  const { data, error } = await supabase.rpc('rpc_update_global_system_role', {
    p_role_id: roleId,
    p_key: key ?? '',
    p_label: label?.trim() ?? '',
    p_description: typeof description === 'string' ? description.trim() : '',
    p_permission_keys: permissionResolution.normalizedPermissionKeys,
  });

  const updatedRoleId = parseRoleIdRpcResult(data);
  if (error || !updatedRoleId) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (error?.message ?? 'Could not update global system role.')
          : 'Could not update global system role.',
    };
  }

  revalidatePlatformPath(PLATFORM_OPERATOR_CONSOLE_PATH);

  return { ok: true, roleId: updatedRoleId };
}

export async function archiveGlobalSystemRoleAction(
  values: z.input<typeof archiveGlobalSystemRoleSchema>
): Promise<RoleCatalogMutateResult> {
  const parsed = archiveGlobalSystemRoleSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, message: 'Not authenticated.' };
  }

  if (!(await canManageGlobalSystemRoleCatalog())) {
    return {
      ok: false,
      message: 'Not allowed to manage global system roles.',
    };
  }

  const { roleId } = parsed.data;
  const { data: roleRow, error: roleErr } = await supabase
    .from('roles')
    .select('id,scope,role_kind,owner_organization_id,is_baseline')
    .eq('id', roleId)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { ok: false, message: 'Role not found.' };
  }

  if (
    roleRow.role_kind !== 'system' ||
    roleRow.scope !== 'global' ||
    roleRow.owner_organization_id !== null ||
    roleRow.is_baseline
  ) {
    return {
      ok: false,
      message: 'Only non-baseline global system roles can be archived.',
    };
  }

  const { data, error } = await supabase.rpc('rpc_archive_global_system_role', {
    p_role_id: roleId,
  });

  const archivedRoleId = parseRoleIdRpcResult(data);
  if (error || !archivedRoleId) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === 'development'
          ? (error?.message ?? 'Could not archive global system role.')
          : 'Could not archive global system role.',
    };
  }

  revalidatePlatformPath(PLATFORM_OPERATOR_CONSOLE_PATH);

  return { ok: true, roleId: archivedRoleId };
}
