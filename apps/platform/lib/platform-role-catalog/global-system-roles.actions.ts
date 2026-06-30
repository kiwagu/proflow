'use server';

import type { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { PLATFORM_OPERATOR_CONSOLE_PATH } from '@/lib/platform-routes';
import { revalidatePlatformPath } from '@/lib/platform-revalidate';

import {
  archiveGlobalSystemRoleSchema,
  createGlobalSystemRoleSchema,
  updateGlobalSystemRoleSchema,
} from './role-catalog.schema';
import {
  ROLE_CATALOG_SELECT_COLUMNS,
  canManageGlobalSystemRoleCatalog,
  ensurePermissionIds,
  mapRoleRowsWithPermissionKeys,
  parseRoleIdRpcResult,
} from './role-catalog.shared';
import type {
  ListGlobalSystemRolesResult,
  RoleCatalogMutateResult,
} from './role-catalog.types';

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
    .select(ROLE_CATALOG_SELECT_COLUMNS)
    .eq('role_kind', 'system')
    .eq('scope', 'global')
    .is('owner_organization_id', null)
    .order('label', { ascending: true });

  if (roleErr) {
    return { ok: false, message: 'Could not load global system roles.' };
  }

  const roles = await mapRoleRowsWithPermissionKeys(supabase, roleRows ?? []);

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
