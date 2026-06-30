'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@workspace/ui/components/button';
import { FieldError } from '@workspace/ui/components/field';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import { EntityAvatarUpload } from '@/components/entity-avatar-upload';

type AvatarMutationResult = { ok: true } | { ok: false; message: string };

type EntityAvatarFormProps = {
  currentValue: string | null;
  entityId: string;
  scopePrefix: string;
  nestedPath?: string;
  submitLabel: string;
  successMessage: string;
  testId: string;
  onSubmit: (avatarUrl: string) => Promise<AvatarMutationResult>;
};

export function EntityAvatarForm({
  currentValue,
  entityId,
  scopePrefix,
  nestedPath,
  submitLabel,
  successMessage,
  testId,
  onSubmit,
}: EntityAvatarFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [avatarUrl, setAvatarUrl] = useState(currentValue ?? '');
  const [submitState, setSubmitState] = useState<AvatarMutationResult | null>(
    null
  );

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentValue`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentValue)) {
    setAvatarUrl(currentValue ?? '');
  }

  useEffect(() => {
    if (!submitState?.ok) {
      return undefined;
    }

    const refreshTimeout = window.setTimeout(() => {
      router.refresh();
    }, 300);

    return () => {
      window.clearTimeout(refreshTimeout);
    };
  }, [router, submitState]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => {
          void onSubmit(avatarUrl).then((result) => {
            setSubmitState(result);
          });
        });
      }}
      noValidate
    >
      <EntityAvatarUpload
        value={avatarUrl || undefined}
        onChange={(value) => {
          setAvatarUrl(value);
          setSubmitState(null);
        }}
        entityId={entityId}
        scopePrefix={scopePrefix}
        nestedPath={nestedPath}
        disabled={isPending}
      />

      {submitState?.ok ? (
        <p className="text-primary text-sm" data-testid={`${testId}-success`}>
          {successMessage}
        </p>
      ) : null}

      {submitState && !submitState.ok ? (
        <FieldError
          className="text-destructive text-sm"
          data-testid={`${testId}-error`}
        >
          {submitState.message}
        </FieldError>
      ) : null}

      <div>
        <Button
          type="submit"
          disabled={isPending}
          data-testid={`${testId}-submit`}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
