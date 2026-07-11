import type {
  PlatformEntitlementRuntimeSettingKey,
  PlatformFeatureFlagRuntimeSettingKey,
} from '@workspace/settings-runtime';
import { Badge } from '@workspace/ui/components/badge';

import { FeatureFlagCheckboxForm } from '@/components/feature-flag-checkbox-form';
import {
  resolveSpaceStatusLabel,
  type OrganizationSettingsSpace,
  type OrganizationSettingsTranslator,
} from '@/app/(account)/organizations/[organizationId]/settings/organization-settings.helpers';

/**
 * One space row inside an organization toggle list (feature rollout or
 * entitlement): name + slug, an effective-state badge, and the per-space
 * `FeatureFlagCheckboxForm`. Behaviour is identical for both lists — only the
 * runtime-setting key, the value, and the testid prefix vary.
 */
export function OrganizationSpaceToggleCard({
  organizationId,
  space,
  organizationEnabled,
  spaceEnabled,
  featureKey,
  cardTestId,
  formTestId,
  t,
}: {
  organizationId: string;
  space: OrganizationSettingsSpace;
  organizationEnabled: boolean;
  spaceEnabled: boolean;
  featureKey:
    PlatformFeatureFlagRuntimeSettingKey | PlatformEntitlementRuntimeSettingKey;
  cardTestId: string;
  formTestId: string;
  t: OrganizationSettingsTranslator;
}) {
  const statusLabel = resolveSpaceStatusLabel(
    organizationEnabled,
    spaceEnabled,
    t
  );

  return (
    <div
      className="border-border flex flex-col gap-4 rounded-md border p-4"
      data-testid={cardTestId}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{space.name}</p>
          <p className="text-muted-foreground text-sm">{space.slug}</p>
        </div>
        <Badge
          variant={
            organizationEnabled && spaceEnabled ? 'default' : 'secondary'
          }
        >
          {statusLabel}
        </Badge>
      </div>

      <FeatureFlagCheckboxForm
        currentValue={spaceEnabled}
        description={t('organizationSettings.featureRollout.spaceDescription', {
          slug: space.slug,
          status: statusLabel,
        })}
        fieldLabel={space.name}
        featureKey={featureKey}
        revalidatePath={`/organizations/${organizationId}/settings`}
        scope="space"
        scopeId={space.id}
        submitLabel={t('runtimeSettings.actions.save')}
        successMessage={t('runtimeSettings.messages.saved')}
        testId={formTestId}
      />
    </div>
  );
}
