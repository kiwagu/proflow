'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RuntimeSettingScope } from '@workspace/settings-runtime';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { SettingsMutationFormShell } from '@workspace/ui/components/platform/settings-mutation-form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import { mutateRuntimeSettingAction } from '@/lib/runtime-settings.actions';

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
  const [selectedValue, setSelectedValue] = useState(currentValue);

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentValue`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentValue)) {
    setSelectedValue(currentValue);
  }

  const selectedUiValue =
    allowInherit && selectedValue.trim().length === 0
      ? INHERIT_SELECT_VALUE
      : selectedValue;

  return (
    <SettingsMutationFormShell
      onSubmit={() =>
        mutateRuntimeSettingAction({
          scope,
          scopeId,
          key: settingKey,
          rawValue: selectedValue,
          mode:
            allowInherit && selectedValue.trim().length === 0
              ? 'inherit'
              : 'set',
          revalidatePath,
        })
      }
      onRefresh={router.refresh}
      submitLabel={submitLabel}
      successMessage={successMessage}
      testId={testId}
    >
      {({ isPending, clearStatus }) => (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={testId}>{fieldLabel}</FieldLabel>
            <Select
              value={selectedUiValue}
              onValueChange={(value) => {
                setSelectedValue(value === INHERIT_SELECT_VALUE ? '' : value);
                clearStatus();
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
      )}
    </SettingsMutationFormShell>
  );
}
