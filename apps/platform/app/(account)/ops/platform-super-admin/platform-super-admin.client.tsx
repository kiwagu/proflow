'use client';

import { useMemo } from 'react';

import { Badge } from '@workspace/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';

import type { PlatformSuperAdminRow as PlatformSuperAdminRowData } from '@/lib/platform-super-admin.server';
import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';

import { PlatformSuperAdminGrantForm } from './platform-super-admin-grant-form';
import { PlatformSuperAdminRow } from './platform-super-admin-row';
import { usePlatformSuperAdminController } from './platform-super-admin.hook';

type PlatformSuperAdminClientProps = Readonly<{
  superAdmins: readonly PlatformSuperAdminRowData[];
  activeCount: number;
  maxActiveCount: number;
  locale: SpaceSettingsLocale;
  loadError?: string | null;
}>;

export function PlatformSuperAdminClient({
  superAdmins,
  activeCount,
  maxActiveCount,
  locale,
  loadError,
}: PlatformSuperAdminClientProps) {
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const controller = usePlatformSuperAdminController({
    t,
    locale,
    superAdminCount: superAdmins.length,
  });

  const atCapacity = activeCount >= maxActiveCount;
  const remainingSlots = Math.max(maxActiveCount - activeCount, 0);

  return (
    <Card data-testid="platform-super-admin-management">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{t('superAdmin.platformAdmins.title')}</CardTitle>
            <CardDescription>
              {t('superAdmin.platformAdmins.description')}
            </CardDescription>
          </div>
          <Badge variant="secondary">
            {t('superAdmin.platformAdmins.capacity', {
              count: String(activeCount),
              max: String(maxActiveCount),
            })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm">
            {t('superAdmin.platformAdmins.remaining', {
              remaining: String(remainingSlots),
            })}
          </p>
          {atCapacity ? (
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.platformAdmins.capacityFull')}
            </p>
          ) : null}
        </div>

        {loadError ? (
          <p className="text-destructive text-sm" role="alert">
            {loadError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium">
              {t('superAdmin.platformAdmins.list.title')}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.platformAdmins.list.description')}
            </p>
          </div>

          {superAdmins.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.platformAdmins.list.empty')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {superAdmins.map((superAdmin) => (
                <PlatformSuperAdminRow
                  key={superAdmin.userId}
                  superAdmin={superAdmin}
                  t={t}
                  dateFormatter={controller.dateFormatter}
                  canRevokeAny={controller.canRevokeAny}
                  isRevokeOpen={
                    controller.revokeTargetUserId === superAdmin.userId
                  }
                  revokeReason={controller.revokeReason}
                  revokeConfirmed={controller.revokeConfirmed}
                  revokeError={controller.revokeError}
                  onToggleRevoke={controller.toggleRevoke}
                  onRevokeReasonChange={controller.setRevokeReason}
                  onRevokeConfirmedChange={controller.setRevokeConfirmed}
                  onSubmitRevoke={(userId) =>
                    void controller.submitRevoke(userId)
                  }
                  onCancelRevoke={controller.resetRevokeForm}
                />
              ))}
            </div>
          )}
        </div>

        <PlatformSuperAdminGrantForm
          form={controller.grantForm}
          t={t}
          confirmed={controller.confirmed}
          onConfirmedChange={controller.setConfirmed}
          atCapacity={atCapacity}
          catalogError={controller.catalogError}
          successMessage={controller.successMessage}
        />
      </CardContent>
    </Card>
  );
}
