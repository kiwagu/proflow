'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * FacetChip — a generic toggle/removable chip. `Badge` is a non-interactive
 * `div`; a facet needs button semantics (`aria-pressed`), a pressed visual, and
 * an optional remove affordance, so this is a distinct primitive rather than an
 * overloaded Badge. Mechanism-only — no domain meaning.
 *
 * `active` drives the pressed look (solid `--primary` fill vs. hairline outline) —
 * a strong, unmistakable selected state. When `onRemove` is supplied a trailing X
 * appears; activating it removes the chip without toggling. Semantic tokens only;
 * Lucide at control size.
 */

export type FacetChipProps = {
  label: string;
  active?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
};

export function FacetChip({
  label,
  active = false,
  onToggle,
  onRemove,
  removeLabel,
  className,
}: FacetChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
        className
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={onToggle}
        className="outline-none"
      >
        {label}
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel ?? `remove ${label}`}
          onClick={onRemove}
          className="hover:text-foreground -mr-1 flex size-4 items-center justify-center rounded-sm transition-colors"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
