'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { RuntimeSettingScope } from '@workspace/settings-runtime';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import {
  mutateRuntimeSettingAction,
  type MutateRuntimeSettingResult,
} from '@/lib/runtime-settings.actions';

type RuntimeSettingCheckboxFormProps = {
  currentValue: boolean;
  description?: string;
  fieldLabel: string;
  revalidatePath: string;
  scope: RuntimeSettingScope;
  scopeId: string | null;
  settingKey: string;
  submitLabel: string;
  successMessage: string;
  testId: string;
};

export function RuntimeSettingCheckboxForm({
  currentValue,
  description,
  fieldLabel,
  revalidatePath,
  scope,
  scopeId,
  settingKey,
  submitLabel,
  successMessage,
  testId,
}: RuntimeSettingCheckboxFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(currentValue);
  const [submitState, setSubmitState] =
    useState<MutateRuntimeSettingResult | null>(null);

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentValue`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentValue)) {
    setChecked(currentValue);
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
          void mutateRuntimeSettingAction({
            scope,
            scopeId,
            key: settingKey,
            rawValue: checked ? 'true' : 'false',
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
          <div className="flex items-start gap-3">
            <Checkbox
              id={testId}
              checked={checked}
              onCheckedChange={(value) => {
                setChecked(value === true);
                setSubmitState(null);
              }}
              data-testid={testId}
              data-current-value={String(checked)}
              disabled={isPending}
            />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={testId}>{fieldLabel}</FieldLabel>
              {description ? (
                <FieldDescription>{description}</FieldDescription>
              ) : null}
            </div>
          </div>
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
