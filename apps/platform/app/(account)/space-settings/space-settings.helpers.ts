import type { PlatformFeatureFlagResolutionSource } from '@/lib/runtime-settings.server';
import type { getSpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.i18n';

export type SpaceSettingsTranslator = ReturnType<
  typeof getSpaceSettingsTranslator
>;

export const delegatedDomainUserPermissionKeys = [
  'space.users.create',
  'space.users.read',
  'space.users.update',
  'space.users.delete',
] as const;

export type DelegatedDomainUserOperation =
  (typeof delegatedDomainUserPermissionKeys)[number];

export function resolveSpaceAdminDelegationRows(
  permissionKeys: readonly string[]
) {
  const grantedKeys = new Set(permissionKeys);
  return delegatedDomainUserPermissionKeys.map((key) => ({
    key,
    allowed: grantedKeys.has(key),
  }));
}

export function getRoleInfo(
  role:
    | { key: string | null; label: string | null }
    | { key: string | null; label: string | null }[]
    | null
    | undefined
): { key: string | null; label: string | null } {
  const row = Array.isArray(role) ? role[0] : role;
  const key =
    typeof row?.key === 'string' && row.key.length > 0 ? row.key : null;
  const label =
    typeof row?.label === 'string' && row.label.length > 0 ? row.label : null;
  return { key, label };
}

export function resolveFeatureStateBadgeLabel(
  enabled: boolean,
  t: SpaceSettingsTranslator
) {
  return enabled
    ? t('spaceSettings.featureVisibility.state.enabled')
    : t('spaceSettings.featureVisibility.state.disabled');
}

export function resolveFeatureSourceLabel(
  source: PlatformFeatureFlagResolutionSource,
  t: SpaceSettingsTranslator
) {
  if (source === 'organization_disabled') {
    return t('spaceSettings.featureVisibility.source.organizationDisabled');
  }

  if (source === 'space_enabled') {
    return t('spaceSettings.featureVisibility.source.spaceEnabled');
  }

  if (source === 'space_disabled') {
    return t('spaceSettings.featureVisibility.source.spaceDisabled');
  }

  if (source === 'organization') {
    return t('spaceSettings.featureVisibility.source.organization');
  }

  return t('spaceSettings.featureVisibility.source.globalDefault');
}

export function getDelegationOperationLabel(
  operation: DelegatedDomainUserOperation,
  t: SpaceSettingsTranslator
) {
  if (operation === 'space.users.create') {
    return t('spaceSettings.delegation.operations.create');
  }
  if (operation === 'space.users.read') {
    return t('spaceSettings.delegation.operations.read');
  }
  if (operation === 'space.users.update') {
    return t('spaceSettings.delegation.operations.update');
  }
  return t('spaceSettings.delegation.operations.delete');
}
