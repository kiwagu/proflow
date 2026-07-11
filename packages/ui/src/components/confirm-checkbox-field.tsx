'use client';

import * as React from 'react';

import { Checkbox } from '@workspace/ui/components/checkbox';
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldTitle,
} from '@workspace/ui/components/field';

/**
 * ConfirmCheckboxField — a horizontal `Field` pairing a `Checkbox` with a confirm
 * label, the idiom every "I understand / confirm" gate uses. Generic and i18n-free:
 * the caller owns the boolean state (`checked` / `onCheckedChange`) and composes its
 * own `disabled` AND-terms at the action; this only renders the control + label and
 * coerces the Radix `boolean | 'indeterminate'` to `true`.
 *
 * `labelAs` selects the label element: `'label'` renders a `FieldLabel` tied via
 * `htmlFor={inputId}`; `'title'` renders a `FieldTitle` with `labelId` and links the
 * checkbox via `aria-labelledby`. Extra checkbox attributes (e.g. `data-testid`) pass
 * through `checkboxProps`.
 */
function ConfirmCheckboxField({
  inputId,
  checked,
  onCheckedChange,
  label,
  labelAs = 'label',
  labelId,
  checkboxProps,
}: {
  inputId?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  labelAs?: 'label' | 'title';
  labelId?: string;
  checkboxProps?: React.ComponentProps<typeof Checkbox> &
    Record<`data-${string}`, string>;
}) {
  return (
    <Field orientation="horizontal">
      <Checkbox
        {...checkboxProps}
        id={inputId}
        aria-labelledby={labelAs === 'title' ? labelId : undefined}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <FieldContent>
        {labelAs === 'title' ? (
          <FieldTitle id={labelId}>{label}</FieldTitle>
        ) : (
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
        )}
      </FieldContent>
    </Field>
  );
}

export { ConfirmCheckboxField };
