'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  PlatformEntitlementRuntimeSettingKey,
  PlatformFeatureFlagRuntimeSettingKey,
} from '@workspace/settings-runtime';
import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { SettingsMutationFormShell } from '@workspace/ui/components/platform/settings-mutation-form';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import { mutatePlatformFeatureFlagAction } from '@/lib/feature-flags.actions';

type FeatureFlagCheckboxFormProps = {
  currentValue: boolean;
  description?: string;
  fieldLabel: string;
  featureKey:
    PlatformFeatureFlagRuntimeSettingKey | PlatformEntitlementRuntimeSettingKey;
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
  const [checked, setChecked] = useState(currentValue);

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentValue`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentValue)) {
    setChecked(currentValue);
  }

  return (
    <SettingsMutationFormShell
      onSubmit={() =>
        mutatePlatformFeatureFlagAction({
          scope,
          scopeId,
          key: featureKey,
          enabled: checked,
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
            <div className="flex items-start gap-3">
              <Checkbox
                id={testId}
                checked={checked}
                onCheckedChange={(value) => {
                  setChecked(value === true);
                  clearStatus();
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
      )}
    </SettingsMutationFormShell>
  );
}
