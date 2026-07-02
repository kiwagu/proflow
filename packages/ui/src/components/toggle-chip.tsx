'use client';

import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

/**
 * ToggleChip — a generic on/off pill: an `aria-pressed` `Button` (the `filterChip` /
 * `pill` variants) with an optional leading icon, optionally wrapped in a `Hint`.
 * Mechanism ONLY and i18n-free — the caller passes a resolved `label` / `hint`, owns the
 * pressed state, and decides what a click means (a true toggle, or a radio-style select
 * where it ignores the reported value). ONE primitive behind the cross-lens filter
 * toggles AND the share-mechanism facet chips — a new chip is a call site, not a fork.
 */
export function ToggleChip({
  label,
  pressed,
  onPressedChange,
  icon,
  hint,
}: {
  label: React.ReactNode;
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  icon?: LucideIcon;
  hint?: string;
}) {
  const Icon = icon;
  const chip = (
    <Button
      type="button"
      variant="filterChip"
      size="pill"
      onClick={() => onPressedChange(!pressed)}
      aria-pressed={pressed}
    >
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {label}
    </Button>
  );
  return hint ? <Hint label={hint}>{chip}</Hint> : chip;
}
