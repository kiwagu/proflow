'use client';

import { useEffect, useState, useTransition } from 'react';
import type * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import { FieldError } from '@workspace/ui/components/field';

/** The shape every settings mutation action resolves to. */
export type SettingsMutationResult = {
  ok: boolean;
  message?: string;
};

/** What the field-body render-prop receives from the shell. */
export type SettingsMutationFieldState = {
  /** True while the submit transition is pending — disable inputs. */
  isPending: boolean;
  /** Clear the last submit status (call when the user edits the draft). */
  clearStatus: () => void;
};

type SettingsMutationFormShellProps = {
  /**
   * The field body. The owning wrapper holds the editable draft `useState` (and its
   * `useValueChanged` resync to the server prop) and renders its inputs here, using
   * `isPending` to disable and `clearStatus` to reset the success/error message.
   */
  children: (state: SettingsMutationFieldState) => React.ReactNode;
  /** Runs the actual mutation; the shell records the result and refreshes on success. */
  onSubmit: () => Promise<SettingsMutationResult>;
  /**
   * Re-fetches the revalidated server state after a successful save (typically the Next
   * `router.refresh` from `next/navigation`, injected by the app so the lib stays
   * framework-agnostic). The shell debounces it 300ms after `onSubmit` resolves `ok`.
   */
  onRefresh: () => void;
  submitLabel: string;
  successMessage: string;
  /**
   * The testid stem. The shell emits `${testId}-success`, `${testId}-error` and
   * `${testId}-submit`; the field body owns the input's own `${testId}` testid.
   */
  testId: string;
};

/**
 * SettingsMutationFormShell — the shared client skeleton behind the platform's per-setting
 * mutation forms (feature-flag checkbox, runtime-setting select/textarea, entity avatar).
 * Owns the `useTransition`, the success/error rendering, the submit `<Button>`, and the
 * 300ms post-success `router.refresh()` so the revalidated server value flows back in. The
 * field body (and its editable draft + `useValueChanged` resync) stays with the owning
 * wrapper, injected via the `children` render-prop — that is where the per-setting action,
 * field markup, and domain copy live. Generic and i18n-free: every label is a resolved
 * string prop and every testid is preserved byte-for-byte for the e2e.
 */
export function SettingsMutationFormShell({
  children,
  onSubmit,
  onRefresh,
  submitLabel,
  successMessage,
  testId,
}: SettingsMutationFormShellProps) {
  const [isPending, startTransition] = useTransition();
  const [submitState, setSubmitState] = useState<SettingsMutationResult | null>(
    null
  );

  useEffect(() => {
    if (!submitState?.ok) {
      return undefined;
    }

    const refreshTimeout = window.setTimeout(() => {
      onRefresh();
    }, 300);

    return () => {
      window.clearTimeout(refreshTimeout);
    };
  }, [onRefresh, submitState]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => {
          void onSubmit().then((result) => {
            setSubmitState(result);
          });
        });
      }}
      noValidate
    >
      {children({ isPending, clearStatus: () => setSubmitState(null) })}

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
