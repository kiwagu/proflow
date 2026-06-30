import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';
import { LabeledStatusRow } from '@workspace/ui/components/platform/labeled-status-row';

import type { PlatformFeatureFlagResolution } from '@/lib/runtime-settings.server';
import {
  resolveFeatureSourceLabel,
  resolveFeatureStateBadgeLabel,
  type SpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.helpers';

export function SpaceFeatureVisibilitySection({
  spaceId,
  feature,
  t,
}: {
  spaceId: string;
  feature: PlatformFeatureFlagResolution;
  t: SpaceSettingsTranslator;
}) {
  return (
    <Card data-testid={`space-feature-visibility-${spaceId}`}>
      <CardHeader>
        <CardTitle>{t('spaceSettings.featureVisibility.title')}</CardTitle>
        <CardDescription>
          {t('spaceSettings.featureVisibility.description')}
        </CardDescription>
        <CardAction>
          <Badge
            data-testid={`space-feature-visibility-effective-${spaceId}`}
            variant={feature.effectiveValue ? 'default' : 'secondary'}
          >
            {resolveFeatureStateBadgeLabel(feature.effectiveValue, t)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <LabeledStatusRow
            label={t('spaceSettings.featureVisibility.organizationGateLabel')}
            data-testid={`space-feature-visibility-organization-gate-${spaceId}`}
          >
            <Badge
              variant={feature.organizationValue ? 'secondary' : 'outline'}
            >
              {resolveFeatureStateBadgeLabel(
                Boolean(feature.organizationValue),
                t
              )}
            </Badge>
          </LabeledStatusRow>

          <LabeledStatusRow
            label={t('spaceSettings.featureVisibility.spaceActivationLabel')}
            data-testid={`space-feature-visibility-space-activation-${spaceId}`}
          >
            <Badge variant={feature.spaceValue ? 'secondary' : 'outline'}>
              {resolveFeatureStateBadgeLabel(Boolean(feature.spaceValue), t)}
            </Badge>
          </LabeledStatusRow>

          <LabeledStatusRow
            label={t('spaceSettings.featureVisibility.resolutionSourceLabel')}
            data-testid={`space-feature-visibility-source-${spaceId}`}
          >
            <span className="text-muted-foreground text-right text-sm">
              {resolveFeatureSourceLabel(feature.source, t)}
            </span>
          </LabeledStatusRow>
        </div>
      </CardContent>
    </Card>
  );
}
