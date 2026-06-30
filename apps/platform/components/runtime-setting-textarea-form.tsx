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
import { Textarea } from '@workspace/ui/components/textarea';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import { mutateRuntimeSettingAction } from '@/lib/runtime-settings.actions';

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
  const [value, setValue] = useState(currentValue);

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentValue`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentValue)) {
    setValue(currentValue);
  }

  return (
    <SettingsMutationFormShell
      onSubmit={() =>
        mutateRuntimeSettingAction({
          scope,
          scopeId,
          key: settingKey,
          rawValue: value,
          mode: 'set',
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
            <Textarea
              id={testId}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                clearStatus();
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
      )}
    </SettingsMutationFormShell>
  );
}
