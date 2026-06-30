import { RUNTIME_SETTING_KEYS } from '@workspace/settings-runtime';
import { Badge } from '@workspace/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import { FeatureFlagCheckboxForm } from '@/components/feature-flag-checkbox-form';
import { OrganizationSpaceToggleCard } from '@/app/(account)/organizations/[organizationId]/settings/sections/organization-space-toggle-card';
import type {
  OrganizationSettingsSpace,
  OrganizationSettingsTranslator,
} from '@/app/(account)/organizations/[organizationId]/settings/organization-settings.helpers';

export function OrganizationEntitlementsSection({
  organizationId,
  advancedStructuralViewEnabled,
  spaces,
  spaceAdvancedStructuralViewValues,
  t,
}: {
  organizationId: string;
  advancedStructuralViewEnabled: boolean;
  spaces: OrganizationSettingsSpace[];
  spaceAdvancedStructuralViewValues: Map<string, boolean>;
  t: OrganizationSettingsTranslator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organizationSettings.entitlements.title')}</CardTitle>
        <CardDescription>
          {t('organizationSettings.entitlements.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Badge
            variant={advancedStructuralViewEnabled ? 'default' : 'secondary'}
          >
            {advancedStructuralViewEnabled
              ? t('organizationSettings.featureRollout.status.enabled')
              : t('organizationSettings.featureRollout.status.disabled')}
          </Badge>
        </div>

        <FeatureFlagCheckboxForm
          currentValue={advancedStructuralViewEnabled}
          description={t(
            'organizationSettings.entitlements.advancedStructuralView.description'
          )}
          fieldLabel={t(
            'organizationSettings.entitlements.advancedStructuralView.label'
          )}
          featureKey={
            RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView
          }
          revalidatePath={`/organizations/${organizationId}/settings`}
          scope="organization"
          scopeId={organizationId}
          submitLabel={t('runtimeSettings.actions.save')}
          successMessage={t('runtimeSettings.messages.saved')}
          testId="organization-entitlement-advanced-structural-view"
        />

        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">
            {t('organizationSettings.featureRollout.spaceListTitle')}
          </p>

          {spaces.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('organizations.emptySpaces')}
            </p>
          ) : (
            spaces.map((space) => (
              <OrganizationSpaceToggleCard
                key={space.id}
                organizationId={organizationId}
                space={space}
                organizationEnabled={advancedStructuralViewEnabled}
                spaceEnabled={
                  spaceAdvancedStructuralViewValues.get(space.id) ?? false
                }
                featureKey={
                  RUNTIME_SETTING_KEYS.platformEntitlementAdvancedStructuralView
                }
                cardTestId={`organization-entitlement-advanced-structural-view-space-card-${space.id}`}
                formTestId={`organization-entitlement-advanced-structural-view-space-${space.id}`}
                t={t}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
