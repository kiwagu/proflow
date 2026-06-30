import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Badge } from '@workspace/ui/components/badge';

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
          <p className="text-destructive text-sm" role="alert">
            {errorMessage}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className="bg-muted/30 border-border flex items-center justify-between rounded-md border px-3 py-2"
                data-testid={`space-delegation-policy-row-${row.key.replaceAll('.', '-')}`}
              >
                <span className="text-sm font-medium">
                  {getDelegationOperationLabel(row.key, t)}
                </span>
                <Badge variant={row.allowed ? 'secondary' : 'outline'}>
                  {row.allowed
                    ? t('spaceSettings.delegation.status.allowed')
                    : t('spaceSettings.delegation.status.denied')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
