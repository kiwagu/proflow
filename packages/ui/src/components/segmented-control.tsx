'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * SegmentedControl — a pill-shaped segmented button group: a `--muted` track with
 * a `p-[3px]` inset, holding one `SegmentedControlButton` per option, the active
 * one lifted onto `--background` with `shadow-sm`. It is the inlined segment markup
 * the KB view-switcher re-declared (`bg-muted flex ... rounded-lg p-[3px]` +
 * per-button `rounded-md px-3.5 py-1.5 ... bg-background shadow-sm`); promoting it
 * keeps the rendered look IDENTICAL while removing the duplication. Mechanism only
 * — options, icons, active-state and disabled/tooltip handling stay with the
 * caller (passed as children).
 *
 * Semantic tokens only, so dark mode is automatic; the track gap is `gap-[3px]`
 * (prototype-exact). Extra classes compose via `className`.
 */

export type SegmentedControlProps = React.ComponentPropsWithoutRef<'div'>;

export function SegmentedControl({
  className,
  ...props
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'bg-muted flex items-center gap-[3px] rounded-lg p-[3px]',
        className
      )}
      {...props}
    />
  );
}

export type SegmentedControlButtonProps =
  React.ComponentPropsWithoutRef<'button'> & {
    /** Active segment — lifted onto `--background` with `shadow-sm`. */
    active?: boolean;
  };

export function SegmentedControlButton({
  className,
  active = false,
  type = 'button',
  disabled,
  ...props
}: SegmentedControlButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-[7px] rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'hover:text-foreground cursor-pointer',
        className
      )}
      {...props}
    />
  );
}
