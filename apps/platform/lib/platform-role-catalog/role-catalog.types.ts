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

export type ListGlobalSystemRolesResult =
  | { ok: true; roles: PlatformRoleCatalogRow[] }
  | { ok: false; message: string };

export type RoleCatalogMutateResult =
  { ok: true; roleId: string } | { ok: false; message: string };
