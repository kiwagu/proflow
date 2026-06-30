'use server';

import type { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { revalidatePlatformPath } from '@/lib/platform-revalidate';

import {
  archiveCustomRoleSchema,
  createCustomRoleSchema,
  updateCustomRoleSchema,
} from './role-catalog.schema';
import {
  ROLE_CATALOG_SELECT_COLUMNS,
  canManageOrganizationRoleCatalog,
  ensurePermissionIds,
  mapRoleRowsWithPermissionKeys,
  parseRoleIdRpcResult,
} from './role-catalog.shared';
import type {
  ListOrganizationCustomRolesResult,
  RoleCatalogMutateResult,
} from './role-catalog.types';

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
    .select(ROLE_CATALOG_SELECT_COLUMNS)
    .eq('role_kind', 'custom')
    .eq('owner_organization_id', organizationId)
    .order('label', { ascending: true });

  if (roleErr) {
    return { ok: false, message: 'Could not load role catalog.' };
  }

  const roles = await mapRoleRowsWithPermissionKeys(supabase, roleRows ?? []);

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
