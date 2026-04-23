'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';

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
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { useForm } from '@workspace/ui/components/tanstack-form';
import { Textarea } from '@workspace/ui/components/textarea';

import {
  grantPlatformSuperAdminAction,
  revokePlatformSuperAdminAction,
} from '@/lib/platform-super-admin.actions';
import type { PlatformSuperAdminRow } from '@/lib/platform-super-admin.server';
import {
  getSpaceSettingsTranslator,
  type SpaceSettingsLocale,
} from '@/app/(account)/space-settings/space-settings.i18n';

type Translator = ReturnType<typeof getSpaceSettingsTranslator>;

type PlatformSuperAdminClientProps = Readonly<{
  superAdmins: readonly PlatformSuperAdminRow[];
  activeCount: number;
  maxActiveCount: number;
  locale: SpaceSettingsLocale;
  loadError?: string | null;
}>;

function createPlatformSuperAdminGrantSchema(t: Translator) {
  return z.object({
    email: z
      .string()
      .trim()
      .min(1, t('superAdmin.platformAdmins.grant.validation.emailRequired'))
      .max(254, t('superAdmin.platformAdmins.grant.validation.emailTooLong'))
      .email(t('superAdmin.platformAdmins.grant.validation.emailInvalid')),
    reason: z
      .string()
      .trim()
      .min(1, t('superAdmin.platformAdmins.grant.validation.reasonRequired'))
      .max(400, t('superAdmin.platformAdmins.grant.validation.reasonTooLong')),
  });
}

function createPlatformSuperAdminRevokeSchema(t: Translator) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(1, t('superAdmin.platformAdmins.revoke.validation.reasonRequired'))
      .max(400, t('superAdmin.platformAdmins.revoke.validation.reasonTooLong')),
  });
}

function formatPlatformSuperAdminDate(
  formatter: Intl.DateTimeFormat,
  value: string
): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}

export function PlatformSuperAdminClient({
  superAdmins,
  activeCount,
  maxActiveCount,
  locale,
  loadError,
}: PlatformSuperAdminClientProps) {
  const router = useRouter();
  const t = useMemo(() => getSpaceSettingsTranslator(locale), [locale]);
  const grantSchema = useMemo(
    () => createPlatformSuperAdminGrantSchema(t),
    [t]
  );
  const revokeSchema = useMemo(
    () => createPlatformSuperAdminRevokeSchema(t),
    [t]
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale]
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [revokeTargetUserId, setRevokeTargetUserId] = useState<string | null>(
    null
  );
  const [revokeReason, setRevokeReason] = useState('');
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const atCapacity = activeCount >= maxActiveCount;
  const remainingSlots = Math.max(maxActiveCount - activeCount, 0);
  const canRevokeAny = superAdmins.length > 1;

  function resetRevokeForm() {
    setRevokeTargetUserId(null);
    setRevokeReason('');
    setRevokeConfirmed(false);
    setRevokeError(null);
  }

  const form = useForm({
    defaultValues: {
      email: '',
      reason: '',
    },
    onSubmit: async ({ value }) => {
      setCatalogError(null);
      setSuccessMessage(null);

      const parsed = grantSchema.safeParse(value);
      if (!parsed.success) {
        setCatalogError(
          parsed.error.issues[0]?.message ??
            t('superAdmin.platformAdmins.grant.validation.invalidPayload')
        );
        return;
      }

      const result = await grantPlatformSuperAdminAction({
        email: parsed.data.email,
        reason: parsed.data.reason,
        confirmed,
      });

      if (!result.ok) {
        setCatalogError(result.message);
        return;
      }

      setSuccessMessage(
        result.status === 'already_granted'
          ? t('superAdmin.platformAdmins.grant.successAlreadyGranted')
          : t('superAdmin.platformAdmins.grant.successGranted')
      );
      form.reset({
        email: '',
        reason: '',
      });
      setConfirmed(false);
      router.refresh();
    },
  });

  async function submitRevoke(userId: string): Promise<void> {
    setCatalogError(null);
    setSuccessMessage(null);
    setRevokeError(null);

    const parsed = revokeSchema.safeParse({ reason: revokeReason });
    if (!parsed.success) {
      setRevokeError(
        parsed.error.issues[0]?.message ??
          t('superAdmin.platformAdmins.revoke.validation.invalidPayload')
      );
      return;
    }

    const result = await revokePlatformSuperAdminAction({
      userId,
      reason: parsed.data.reason,
      confirmed: revokeConfirmed,
    });

    if (!result.ok) {
      setRevokeError(result.message);
      return;
    }

    setSuccessMessage(
      result.status === 'already_revoked'
        ? t('superAdmin.platformAdmins.revoke.successAlreadyRevoked')
        : t('superAdmin.platformAdmins.revoke.successRevoked')
    );
    resetRevokeForm();
    router.refresh();
  }

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
              {superAdmins.map((superAdmin) => {
                const primaryLabel =
                  superAdmin.displayName ??
                  superAdmin.email ??
                  t('superAdmin.platformAdmins.list.userFallback', {
                    userId: superAdmin.userId,
                  });

                return (
                  <Card
                    key={superAdmin.userId}
                    size="sm"
                    data-testid={`platform-super-admin-row-${superAdmin.userId}`}
                  >
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-col gap-1">
                          <CardTitle>{primaryLabel}</CardTitle>
                          {superAdmin.email ? (
                            <CardDescription>
                              {superAdmin.email}
                            </CardDescription>
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
                          onClick={() => {
                            if (revokeTargetUserId === superAdmin.userId) {
                              resetRevokeForm();
                              return;
                            }

                            setRevokeTargetUserId(superAdmin.userId);
                            setRevokeReason('');
                            setRevokeConfirmed(false);
                            setRevokeError(null);
                          }}
                        >
                          {t('superAdmin.platformAdmins.revoke.toggle')}
                        </Button>
                        {!canRevokeAny ? (
                          <span className="text-muted-foreground text-xs">
                            {t(
                              'superAdmin.platformAdmins.revoke.lastActiveHint'
                            )}
                          </span>
                        ) : null}
                      </div>
                      {revokeTargetUserId === superAdmin.userId ? (
                        <div
                          className="border-border mt-2 flex flex-col gap-3 rounded-md border p-3"
                          data-testid={`platform-super-admin-revoke-form-${superAdmin.userId}`}
                        >
                          <Field>
                            <FieldLabel
                              htmlFor={`platform-super-admin-revoke-reason-${superAdmin.userId}`}
                            >
                              {t(
                                'superAdmin.platformAdmins.revoke.reasonLabel'
                              )}
                            </FieldLabel>
                            <Textarea
                              id={`platform-super-admin-revoke-reason-${superAdmin.userId}`}
                              rows={3}
                              value={revokeReason}
                              onChange={(event) =>
                                setRevokeReason(event.target.value)
                              }
                              placeholder={t(
                                'superAdmin.platformAdmins.revoke.reasonPlaceholder'
                              )}
                              data-testid={`platform-super-admin-revoke-reason-${superAdmin.userId}`}
                            />
                            <FieldDescription>
                              {t(
                                'superAdmin.platformAdmins.revoke.reasonDescription'
                              )}
                            </FieldDescription>
                          </Field>

                          <Field orientation="horizontal">
                            <Checkbox
                              id={`platform-super-admin-revoke-confirm-${superAdmin.userId}`}
                              aria-labelledby={`platform-super-admin-revoke-confirm-label-${superAdmin.userId}`}
                              checked={revokeConfirmed}
                              onCheckedChange={(value) =>
                                setRevokeConfirmed(value === true)
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
                            <p
                              className="text-destructive text-sm"
                              role="alert"
                            >
                              {revokeError}
                            </p>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              data-testid={`platform-super-admin-revoke-submit-${superAdmin.userId}`}
                              disabled={!revokeConfirmed}
                              onClick={() =>
                                void submitRevoke(superAdmin.userId)
                              }
                            >
                              {t('superAdmin.platformAdmins.revoke.submit')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={resetRevokeForm}
                            >
                              {t('superAdmin.platformAdmins.revoke.cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-medium">
              {t('superAdmin.platformAdmins.grant.title')}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t('superAdmin.platformAdmins.grant.description')}
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <FieldGroup>
              <form.Field name="email">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      {t('superAdmin.platformAdmins.grant.emailLabel')}
                    </FieldLabel>
                    <Input
                      id={field.name}
                      type="email"
                      data-testid="platform-super-admin-grant-email"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value.toLowerCase())
                      }
                      placeholder={t(
                        'superAdmin.platformAdmins.grant.emailPlaceholder'
                      )}
                    />
                    <FieldDescription>
                      {t('superAdmin.platformAdmins.grant.emailDescription')}
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>

              <form.Field name="reason">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={field.name}>
                      {t('superAdmin.platformAdmins.grant.reasonLabel')}
                    </FieldLabel>
                    <Textarea
                      id={field.name}
                      rows={3}
                      data-testid="platform-super-admin-grant-reason"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      placeholder={t(
                        'superAdmin.platformAdmins.grant.reasonPlaceholder'
                      )}
                    />
                    <FieldDescription>
                      {t('superAdmin.platformAdmins.grant.reasonDescription')}
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>

              <Field orientation="horizontal">
                <Checkbox
                  id="grant-platform-super-admin-confirm"
                  aria-labelledby="platform-super-admin-grant-confirm-label"
                  data-testid="platform-super-admin-grant-confirm"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                <FieldContent>
                  <FieldTitle id="platform-super-admin-grant-confirm-label">
                    {t('superAdmin.platformAdmins.grant.confirm')}
                  </FieldTitle>
                </FieldContent>
              </Field>
            </FieldGroup>

            {catalogError ? (
              <p className="text-destructive text-sm" role="alert">
                {catalogError}
              </p>
            ) : null}
            {successMessage ? (
              <p className="text-sm text-emerald-700" role="status">
                {successMessage}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!confirmed || atCapacity}
                data-testid="platform-super-admin-grant-submit"
              >
                {t('superAdmin.platformAdmins.grant.submit')}
              </Button>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
