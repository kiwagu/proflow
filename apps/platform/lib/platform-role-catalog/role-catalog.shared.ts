import {
  CRITICAL_CAPABILITY_KEYS,
  hasCriticalCapability,
} from '@workspace/rbac/critical-capability';

import { getIsOrgAdminForOrganization } from '@/lib/platform-org-admin';
import { createClient } from '@/lib/supabase/server';

import type { PlatformRoleCatalogRow } from './role-catalog.types';

export function normalizePermissionKeys(
  permissionKeys: readonly string[]
): string[] {
  return [
    ...new Set(permissionKeys.map((value) => value.trim()).filter(Boolean)),
  ];
}

export function extractPermissionKey(value: unknown): string | null {
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

export function parseRoleIdRpcResult(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export async function canManageOrganizationRoleCatalog(
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

export async function canManageGlobalSystemRoleCatalog(): Promise<boolean> {
  const supabase = await createClient();
  return hasCriticalCapability(
    supabase,
    CRITICAL_CAPABILITY_KEYS.platformAdminOverride
  );
}

export async function ensurePermissionIds(
  permissionKeys: readonly string[]
): Promise<
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

const ROLE_CATALOG_SELECT_COLUMNS =
  'id,key,label,description,scope,role_kind,owner_organization_id,is_baseline,is_mutable,archived_at';

type RoleCatalogDbRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  scope: string;
  role_kind: string;
  owner_organization_id: string | null;
  is_baseline: boolean;
  is_mutable: boolean;
  archived_at: string | null;
};

export { ROLE_CATALOG_SELECT_COLUMNS };

export async function mapRoleRowsWithPermissionKeys(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleRows: readonly RoleCatalogDbRow[]
): Promise<PlatformRoleCatalogRow[]> {
  const roleIds = roleRows.map((row) => row.id);
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

  return roleRows.map((row) => ({
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
}
