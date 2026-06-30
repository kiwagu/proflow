'use client';

import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card';
import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@workspace/ui/components/field';
import { Textarea } from '@workspace/ui/components/textarea';

import type { PlatformSuperAdminRow as PlatformSuperAdminRowData } from '@/lib/platform-super-admin.server';

import { formatPlatformSuperAdminDate } from './platform-super-admin.format';
import type { Translator } from './platform-super-admin.schema';

type PlatformSuperAdminRowProps = Readonly<{
  superAdmin: PlatformSuperAdminRowData;
  t: Translator;
  dateFormatter: Intl.DateTimeFormat;
  canRevokeAny: boolean;
  isRevokeOpen: boolean;
  revokeReason: string;
  revokeConfirmed: boolean;
  revokeError: string | null;
  onToggleRevoke: (userId: string) => void;
  onRevokeReasonChange: (value: string) => void;
  onRevokeConfirmedChange: (value: boolean) => void;
  onSubmitRevoke: (userId: string) => void;
  onCancelRevoke: () => void;
}>;

export function PlatformSuperAdminRow({
  superAdmin,
  t,
  dateFormatter,
  canRevokeAny,
  isRevokeOpen,
  revokeReason,
  revokeConfirmed,
  revokeError,
  onToggleRevoke,
  onRevokeReasonChange,
  onRevokeConfirmedChange,
  onSubmitRevoke,
  onCancelRevoke,
}: PlatformSuperAdminRowProps) {
  const primaryLabel =
    superAdmin.displayName ??
    superAdmin.email ??
    t('superAdmin.platformAdmins.list.userFallback', {
      userId: superAdmin.userId,
    });

  return (
    <Card
      size="sm"
      data-testid={`platform-super-admin-row-${superAdmin.userId}`}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>{primaryLabel}</CardTitle>
            {superAdmin.email ? (
              <CardDescription>{superAdmin.email}</CardDescription>
            ) : null}
          </div>
          <Badge variant="outline">
            {t('superAdmin.platformAdmins.list.grantedAt', {
              date: formatPlatformSuperAdminDate(
                dateFormatter,
                superAdmin.grantedAt
              ),
            })}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {superAdmin.reason ? (
          <p>
            {t('superAdmin.platformAdmins.list.reason', {
              reason: superAdmin.reason,
            })}
          </p>
        ) : null}
        {superAdmin.grantedByLabel ? (
          <p className="text-muted-foreground">
            {t('superAdmin.platformAdmins.list.grantedBy', {
              actor: superAdmin.grantedByLabel,
            })}
          </p>
        ) : null}
        <p className="text-muted-foreground">
          {superAdmin.lastSignInAt
            ? t('superAdmin.platformAdmins.list.lastSignIn', {
                date: formatPlatformSuperAdminDate(
                  dateFormatter,
                  superAdmin.lastSignInAt
                ),
              })
            : t('superAdmin.platformAdmins.list.neverSignedIn')}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid={`platform-super-admin-revoke-toggle-${superAdmin.userId}`}
            disabled={!canRevokeAny}
            onClick={() => onToggleRevoke(superAdmin.userId)}
          >
            {t('superAdmin.platformAdmins.revoke.toggle')}
          </Button>
          {!canRevokeAny ? (
            <span className="text-muted-foreground text-xs">
              {t('superAdmin.platformAdmins.revoke.lastActiveHint')}
            </span>
          ) : null}
        </div>
        {isRevokeOpen ? (
          <div
            className="border-border mt-2 flex flex-col gap-3 rounded-md border p-3"
            data-testid={`platform-super-admin-revoke-form-${superAdmin.userId}`}
          >
            <Field>
              <FieldLabel
                htmlFor={`platform-super-admin-revoke-reason-${superAdmin.userId}`}
              >
                {t('superAdmin.platformAdmins.revoke.reasonLabel')}
              </FieldLabel>
              <Textarea
                id={`platform-super-admin-revoke-reason-${superAdmin.userId}`}
                rows={3}
                value={revokeReason}
                onChange={(event) => onRevokeReasonChange(event.target.value)}
                placeholder={t(
                  'superAdmin.platformAdmins.revoke.reasonPlaceholder'
                )}
                data-testid={`platform-super-admin-revoke-reason-${superAdmin.userId}`}
              />
              <FieldDescription>
                {t('superAdmin.platformAdmins.revoke.reasonDescription')}
              </FieldDescription>
            </Field>

            <Field orientation="horizontal">
              <Checkbox
                id={`platform-super-admin-revoke-confirm-${superAdmin.userId}`}
                aria-labelledby={`platform-super-admin-revoke-confirm-label-${superAdmin.userId}`}
                checked={revokeConfirmed}
                onCheckedChange={(value) =>
                  onRevokeConfirmedChange(value === true)
                }
                data-testid={`platform-super-admin-revoke-confirm-${superAdmin.userId}`}
              />
              <FieldContent>
                <FieldTitle
                  id={`platform-super-admin-revoke-confirm-label-${superAdmin.userId}`}
                >
                  {t('superAdmin.platformAdmins.revoke.confirm')}
                </FieldTitle>
              </FieldContent>
            </Field>

            {revokeError ? (
              <p className="text-destructive text-sm" role="alert">
                {revokeError}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                data-testid={`platform-super-admin-revoke-submit-${superAdmin.userId}`}
                disabled={!revokeConfirmed}
                onClick={() => onSubmitRevoke(superAdmin.userId)}
              >
                {t('superAdmin.platformAdmins.revoke.submit')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onCancelRevoke}
              >
                {t('superAdmin.platformAdmins.revoke.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
