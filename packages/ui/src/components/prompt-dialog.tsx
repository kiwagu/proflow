'use client';

import * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';

/**
 * PromptDialog — a generic single-text-field modal (rename, "name the new X", …).
 * Mechanism only: it owns the draft state (seeded from `defaultValue` each time it
 * opens) and hands the trimmed value to `onSubmit`; the caller owns `open` and
 * closes after the async action. Submit is disabled while empty or `busy`; Enter
 * submits.
 */

export function PromptDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  defaultValue = '',
  submitLabel,
  cancelLabel,
  onSubmit,
  busy = false,
  submitIcon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  placeholder?: string;
  defaultValue?: string;
  submitLabel: React.ReactNode;
  cancelLabel: React.ReactNode;
  onSubmit: (value: string) => void;
  busy?: boolean;
  /** Pre-rendered leading icon for the submit button. */
  submitIcon?: React.ReactNode;
}) {
  const [value, setValue] = React.useState(defaultValue);

  // Reseed the draft whenever the dialog (re)opens.
  React.useEffect(() => {
    if (open) {
      setValue(defaultValue);
    }
  }, [open, defaultValue]);

  const disabled = busy || !value.trim();
  function submit() {
    if (!disabled) {
      onSubmit(value.trim());
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={busy}
          autoFocus
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={disabled}>
            {submitIcon}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
