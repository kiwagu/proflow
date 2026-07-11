'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { RuntimeSettingScope } from '@workspace/settings-runtime';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/field';
import { Input } from '@workspace/ui/components/input';
import { SettingsMutationFormShell } from '@workspace/ui/components/platform/settings-mutation-form';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';

import { mutateRuntimeSettingAction } from '@/lib/runtime-settings.actions';

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** bytes → whole MB (MiB), for presenting a stored byte value in the input. */
function bytesToMegabytes(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MEGABYTE);
}

/** MB (MiB) → bytes, for the value stored via the registry (which is byte-typed). */
function megabytesToBytes(megabytes: number): number {
  return Math.round(megabytes * BYTES_PER_MEGABYTE);
}

type RuntimeSettingNumberFormProps = {
  /** Current stored value in BYTES for this scope, or null when unset (inherits). */
  currentBytes: number | null;
  /** The effective default in BYTES, shown as the placeholder/help when unset. */
  defaultBytes: number;
  /** The hard cap in BYTES; the MB input is clamp-validated to this. */
  hardCapBytes: number;
  description: string;
  fieldLabel: string;
  /** Label for the "value X MB" unit shown after the input. */
  unitLabel: string;
  /** Message when the entered MB exceeds the hard cap (pre-resolved with {max}). A
   * server component renders this form, so message copy must be plain strings — a
   * function prop cannot cross the server→client boundary. */
  overCapMessage: string;
  /** Message when the entered value is not a positive number. */
  invalidMessage: string;
  /** Placeholder/help copy for the effective default (pre-resolved with {default}). */
  defaultHint: string;
  revalidatePath: string;
  scope: RuntimeSettingScope;
  scopeId: string | null;
  settingKey: string;
  submitLabel: string;
  successMessage: string;
  testId: string;
};

/**
 * RuntimeSettingNumberForm — the numeric counterpart to the select/textarea runtime
 * setting forms. Mirrors their exact shape (SettingsMutationFormShell + editable draft
 * + useValueChanged resync + mutateRuntimeSettingAction), but the setting is a byte
 * count presented/entered in MB: the draft holds the MB string, and bytes are converted
 * at the action boundary. An empty draft submits `mode: 'inherit'` (deletes the row so
 * the value falls back to global/default). Over-cap and non-numeric drafts are validated
 * client-side (the registry schema `.max()` remains the server authority).
 */
export function RuntimeSettingNumberForm({
  currentBytes,
  defaultBytes,
  hardCapBytes,
  description,
  fieldLabel,
  unitLabel,
  overCapMessage,
  invalidMessage,
  defaultHint,
  revalidatePath,
  scope,
  scopeId,
  settingKey,
  submitLabel,
  successMessage,
  testId,
}: RuntimeSettingNumberFormProps) {
  const router = useRouter();
  const currentMegabytes =
    currentBytes === null ? '' : String(bytesToMegabytes(currentBytes));
  const [megabytesDraft, setMegabytesDraft] = useState(currentMegabytes);

  // Re-sync the editable draft to a NEW server value during render (e.g. after a
  // saved mutation revalidates `currentBytes`) — the "adjust state when a prop
  // changes" pattern, no effect needed.
  if (useValueChanged(currentMegabytes)) {
    setMegabytesDraft(currentMegabytes);
  }

  const hardCapMegabytes = bytesToMegabytes(hardCapBytes);
  const defaultMegabytes = bytesToMegabytes(defaultBytes);

  const trimmed = megabytesDraft.trim();
  const parsedMegabytes = Number(trimmed);
  const isEmpty = trimmed.length === 0;
  const isNumeric =
    !isEmpty && Number.isFinite(parsedMegabytes) && parsedMegabytes > 0;
  const isOverCap =
    isNumeric && megabytesToBytes(parsedMegabytes) > hardCapBytes;

  const validationError = isEmpty
    ? null
    : !isNumeric
      ? invalidMessage
      : isOverCap
        ? overCapMessage
        : null;

  return (
    <SettingsMutationFormShell
      onSubmit={() => {
        if (isEmpty) {
          return mutateRuntimeSettingAction({
            scope,
            scopeId,
            key: settingKey,
            rawValue: '',
            mode: 'inherit',
            revalidatePath,
          });
        }

        if (validationError) {
          return Promise.resolve({ ok: false, message: validationError });
        }

        return mutateRuntimeSettingAction({
          scope,
          scopeId,
          key: settingKey,
          rawValue: String(megabytesToBytes(parsedMegabytes)),
          mode: 'set',
          revalidatePath,
        });
      }}
      onRefresh={router.refresh}
      submitLabel={submitLabel}
      successMessage={successMessage}
      testId={testId}
    >
      {({ isPending, clearStatus }) => (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={testId}>{fieldLabel}</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                id={testId}
                type="number"
                inputMode="numeric"
                min={1}
                max={hardCapMegabytes}
                step={1}
                value={megabytesDraft}
                onChange={(event) => {
                  setMegabytesDraft(event.target.value);
                  clearStatus();
                }}
                placeholder={String(defaultMegabytes)}
                className="w-40"
                data-testid={testId}
                data-current-bytes={currentBytes ?? ''}
                aria-invalid={validationError ? true : undefined}
                disabled={isPending}
              />
              <span className="text-muted-foreground text-sm">{unitLabel}</span>
            </div>
            {validationError ? (
              <FieldError data-testid={`${testId}-validation`}>
                {validationError}
              </FieldError>
            ) : (
              <FieldDescription>
                {description} {defaultHint}
              </FieldDescription>
            )}
          </Field>
        </FieldGroup>
      )}
    </SettingsMutationFormShell>
  );
}
