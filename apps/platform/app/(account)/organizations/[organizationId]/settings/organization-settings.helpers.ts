import type { SpaceSettingsTranslator } from '@/app/(account)/space-settings/space-settings.helpers';

export type OrganizationSettingsTranslator = SpaceSettingsTranslator;

export type OrganizationSettingsSpace = {
  id: string;
  name: string;
  slug: string;
};

/**
 * Reduce `runtime_settings` rows (`{ scope_id, value }`) into a per-space lookup
 * of boolean values, ignoring rows with non-string ids or non-boolean values.
 */
export function buildSpaceBooleanSettingMap(
  rows: ReadonlyArray<{ scope_id: string | null; value: unknown }> | null
): Map<string, boolean> {
  const values = new Map<string, boolean>();
  for (const row of rows ?? []) {
    if (typeof row.scope_id === 'string' && typeof row.value === 'boolean') {
      values.set(row.scope_id, row.value);
    }
  }
  return values;
}

/**
 * Resolve the per-space status badge label: when the organization gate is off
 * every space reads as disabled-by-organization; otherwise it reflects the
 * space's own enabled flag.
 */
export function resolveSpaceStatusLabel(
  organizationEnabled: boolean,
  spaceEnabled: boolean,
  t: OrganizationSettingsTranslator
): string {
  if (!organizationEnabled) {
    return t(
      'organizationSettings.featureRollout.status.disabledByOrganization'
    );
  }
  return spaceEnabled
    ? t('organizationSettings.featureRollout.status.enabled')
    : t('organizationSettings.featureRollout.status.disabled');
}
