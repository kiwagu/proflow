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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';

import {
  mutateRuntimeSettingAction,
  type MutateRuntimeSettingResult,
} from '@/lib/runtime-settings.actions';

type RuntimeSettingSelectOption = {
  label: string;
  value: string;
};

const INHERIT_SELECT_VALUE = '__inherit__';

type RuntimeSettingSelectFormProps = {
  allowInherit?: boolean;
  currentValue: string;
  description?: string;
  fieldLabel: string;
  inheritOptionLabel?: string;
  revalidatePath: string;
  scope: RuntimeSettingScope;
  scopeId: string | null;
  settingKey: string;
  submitLabel: string;
  successMessage: string;
  options: RuntimeSettingSelectOption[];
  testId: string;
};

export function RuntimeSettingSelectForm({
  allowInherit = false,
  currentValue,
  description,
  fieldLabel,
  inheritOptionLabel,
  revalidatePath,
  scope,
  scopeId,
  settingKey,
  submitLabel,
  successMessage,
  options,
  testId,
}: RuntimeSettingSelectFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedValue, setSelectedValue] = useState(currentValue);
  const [submitState, setSubmitState] =
    useState<MutateRuntimeSettingResult | null>(null);
  const selectedUiValue =
    allowInherit && selectedValue.trim().length === 0
      ? INHERIT_SELECT_VALUE
      : selectedValue;

  useEffect(() => {
    setSelectedValue(currentValue);
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
            rawValue: selectedValue,
            mode:
              allowInherit && selectedValue.trim().length === 0
                ? 'inherit'
                : 'set',
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
          <Select
            value={selectedUiValue}
            onValueChange={(value) => {
              setSelectedValue(value === INHERIT_SELECT_VALUE ? '' : value);
              setSubmitState(null);
            }}
            disabled={isPending}
          >
            <SelectTrigger
              id={testId}
              className="w-full"
              data-testid={testId}
              data-current-value={selectedValue}
            >
              <SelectValue placeholder={inheritOptionLabel} />
            </SelectTrigger>
            <SelectContent className="w-[var(--radix-select-trigger-width)]">
              {allowInherit && inheritOptionLabel ? (
                <SelectItem
                  value={INHERIT_SELECT_VALUE}
                  data-testid={`${testId}-option-inherit`}
                >
                  {inheritOptionLabel}
                </SelectItem>
              ) : null}
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  data-testid={`${testId}-option-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
