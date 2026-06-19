'use client';

import * as React from 'react';

import { Checkbox } from '@workspace/ui/components/checkbox';
import { cn } from '@workspace/ui/lib/utils';

/**
 * FacetCheckbox — a generic checkbox facet ROW: a checkbox + an optional leading
 * icon + a label, laid out as one clickable `<label>` line. Mechanism-only: the
 * caller owns checked state, the toggle handler, and supplies the icon node (so the
 * primitive never imports an icon set). Styled strictly through semantic tokens.
 *
 * This is the "checkbox list" facet shape (e.g. filter-by-type, health filters),
 * distinct from the pill-shaped `FacetChip` toggle.
 */

export type FacetCheckboxProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Optional leading icon node (e.g. a Lucide icon supplied by the caller). */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function FacetCheckbox({
  checked,
  onCheckedChange,
  icon,
  children,
  className,
}: FacetCheckboxProps) {
  return (
    <label
      className={cn(
        'hover:bg-accent flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm transition-colors',
        className
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      {icon ? (
        <span
          className="text-muted-foreground flex shrink-0 items-center"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1">{children}</span>
    </label>
  );
}
