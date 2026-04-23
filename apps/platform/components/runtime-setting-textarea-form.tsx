'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { RuntimeSettingScope } from '@workspace/settings-runtime';
import { Button } from '@workspace/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Textarea } from '@workspace/ui/components/textarea';

import {
  mutateRuntimeSettingAction,
  type MutateRuntimeSettingResult,
} from '@/lib/runtime-settings.actions';

type RuntimeSettingTextareaFormProps = {
  currentValue: string;
  description?: string;
  fieldLabel: string;
  revalidatePath: string;
  rows?: number;
  scope: RuntimeSettingScope;
  scopeId: string | null;
  settingKey: string;
  submitLabel: string;
  successMessage: string;
  testId: string;
};

export function RuntimeSettingTextareaForm({
  currentValue,
  description,
  fieldLabel,
  revalidatePath,
  rows = 8,
  scope,
  scopeId,
  settingKey,
  submitLabel,
  successMessage,
  testId,
}: RuntimeSettingTextareaFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(currentValue);
  const [submitState, setSubmitState] =
    useState<MutateRuntimeSettingResult | null>(null);

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

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
          void mutateRuntimeSettingAction({
            scope,
            scopeId,
            key: settingKey,
            rawValue: value,
            mode: 'set',
            revalidatePath,
          }).then((result) => {
            setSubmitState(result);
          });
        });
      }}
      noValidate
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={testId}>{fieldLabel}</FieldLabel>
          <Textarea
            id={testId}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setSubmitState(null);
            }}
            rows={rows}
            className="min-h-32 font-mono text-xs"
            data-testid={testId}
            disabled={isPending}
          />
          {description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>

      {submitState?.ok ? (
        <p className="text-primary text-sm" data-testid={`${testId}-success`}>
          {successMessage}
        </p>
      ) : null}

      {submitState && !submitState.ok ? (
        <p
          className="text-destructive text-sm"
          data-testid={`${testId}-error`}
          role="alert"
        >
          {submitState.message}
        </p>
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
