'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useForm } from '@workspace/ui/components/tanstack-form';

import {
  grantPlatformSuperAdminAction,
  revokePlatformSuperAdminAction,
} from '@/lib/platform-super-admin.actions';

import {
  createPlatformSuperAdminGrantSchema,
  createPlatformSuperAdminRevokeSchema,
  type PlatformSuperAdminLocale,
  type Translator,
} from './platform-super-admin.schema';

type UsePlatformSuperAdminControllerArgs = Readonly<{
  t: Translator;
  locale: PlatformSuperAdminLocale;
  superAdminCount: number;
}>;

export function usePlatformSuperAdminController({
  t,
  locale,
  superAdminCount,
}: UsePlatformSuperAdminControllerArgs) {
  const router = useRouter();
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

  const canRevokeAny = superAdminCount > 1;

  function resetRevokeForm() {
    setRevokeTargetUserId(null);
    setRevokeReason('');
    setRevokeConfirmed(false);
    setRevokeError(null);
  }

  const grantForm = useForm({
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
      grantForm.reset({
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

  function toggleRevoke(userId: string): void {
    if (revokeTargetUserId === userId) {
      resetRevokeForm();
      return;
    }

    setRevokeTargetUserId(userId);
    setRevokeReason('');
    setRevokeConfirmed(false);
    setRevokeError(null);
  }

  return {
    grantForm,
    dateFormatter,
    catalogError,
    successMessage,
    confirmed,
    setConfirmed,
    canRevokeAny,
    revokeTargetUserId,
    revokeReason,
    setRevokeReason,
    revokeConfirmed,
    setRevokeConfirmed,
    revokeError,
    submitRevoke,
    toggleRevoke,
    resetRevokeForm,
  };
}

export type PlatformSuperAdminController = ReturnType<
  typeof usePlatformSuperAdminController
>;
