import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { FieldError } from '@workspace/ui/components/field';
import { Badge } from '@workspace/ui/components/badge';
import { LabeledStatusRow } from '@workspace/ui/components/platform/labeled-status-row';

import {
  getDelegationOperationLabel,
  resolveSpaceAdminDelegationRows,
  type SpaceSettingsTranslator,
} from '@/app/(account)/space-settings/space-settings.helpers';

export function SpaceDelegationPolicySection({
  spaceId,
  rows,
  errorMessage,
  t,
}: {
  spaceId: string;
  rows: ReturnType<typeof resolveSpaceAdminDelegationRows>;
  errorMessage: string | null;
  t: SpaceSettingsTranslator;
}) {
  return (
    <Card data-testid={`space-delegation-policy-${spaceId}`}>
      <CardHeader>
        <CardTitle>{t('spaceSettings.delegation.title')}</CardTitle>
        <CardDescription>
          {t('spaceSettings.delegation.description')}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {t('spaceSettings.delegation.denyByDefault')}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {errorMessage ? (
          <FieldError className="text-destructive text-sm">
            {errorMessage}
          </FieldError>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <LabeledStatusRow
                key={row.key}
                label={getDelegationOperationLabel(row.key, t)}
                data-testid={`space-delegation-policy-row-${row.key.replaceAll('.', '-')}`}
              >
                <Badge variant={row.allowed ? 'secondary' : 'outline'}>
                  {row.allowed
                    ? t('spaceSettings.delegation.status.allowed')
                    : t('spaceSettings.delegation.status.denied')}
                </Badge>
              </LabeledStatusRow>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
