'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type {
  PlatformEntitlementRuntimeSettingKey,
  PlatformFeatureFlagRuntimeSettingKey,
} from '@workspace/settings-runtime';
import { Button } from '@workspace/ui/components/button';
import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';

import {
  mutatePlatformFeatureFlagAction,
  type MutatePlatformFeatureFlagResult,
} from '@/lib/feature-flags.actions';

type FeatureFlagCheckboxFormProps = {
  currentValue: boolean;
  description?: string;
  fieldLabel: string;
  featureKey:
    | PlatformFeatureFlagRuntimeSettingKey
    | PlatformEntitlementRuntimeSettingKey;
  revalidatePath: string;
  scope: 'global' | 'organization' | 'space';
  scopeId: string | null;
  submitLabel: string;
  successMessage: string;
  testId: string;
};

export function FeatureFlagCheckboxForm({
  currentValue,
  description,
  fieldLabel,
  featureKey,
  revalidatePath,
  scope,
  scopeId,
  submitLabel,
  successMessage,
  testId,
}: FeatureFlagCheckboxFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [checked, setChecked] = useState(currentValue);
  const [submitState, setSubmitState] =
    useState<MutatePlatformFeatureFlagResult | null>(null);

  useEffect(() => {
    setChecked(currentValue);
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
          void mutatePlatformFeatureFlagAction({
            scope,
            scopeId,
            key: featureKey,
            enabled: checked,
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
