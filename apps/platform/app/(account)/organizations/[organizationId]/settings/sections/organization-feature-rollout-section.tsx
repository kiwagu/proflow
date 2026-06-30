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

export function OrganizationFeatureRolloutSection({
  organizationId,
  organizationFeatureEnabled,
  spaces,
  spaceFeatureValues,
  t,
}: {
  organizationId: string;
  organizationFeatureEnabled: boolean;
  spaces: OrganizationSettingsSpace[];
  spaceFeatureValues: Map<string, boolean>;
  t: OrganizationSettingsTranslator;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organizationSettings.featureRollout.title')}</CardTitle>
        <CardDescription>
          {t('organizationSettings.featureRollout.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Badge variant={organizationFeatureEnabled ? 'default' : 'secondary'}>
            {organizationFeatureEnabled
              ? t('organizationSettings.featureRollout.status.enabled')
              : t('organizationSettings.featureRollout.status.disabled')}
          </Badge>
        </div>

        <FeatureFlagCheckboxForm
          currentValue={organizationFeatureEnabled}
          description={t(
            'organizationSettings.featureRollout.organizationGateDescription'
          )}
          fieldLabel={t(
            'organizationSettings.featureRollout.organizationGateLabel'
          )}
          featureKey={
            RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
          }
          revalidatePath={`/organizations/${organizationId}/settings`}
          scope="organization"
          scopeId={organizationId}
          submitLabel={t('runtimeSettings.actions.save')}
          successMessage={t('runtimeSettings.messages.saved')}
          testId="organization-feature-flag-organization-settings"
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
                organizationEnabled={organizationFeatureEnabled}
                spaceEnabled={spaceFeatureValues.get(space.id) ?? false}
                featureKey={
                  RUNTIME_SETTING_KEYS.platformFeatureFlagOrganizationSettings
                }
                cardTestId={`organization-feature-flag-space-card-${space.id}`}
                formTestId={`organization-feature-flag-space-${space.id}`}
                t={t}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
