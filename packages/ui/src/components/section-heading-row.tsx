import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * SectionHeadingRow — a `RailSectionHeading` that carries a LEADING icon on the
 * same baseline, plus an optional trailing slot. It is the `h3` heading the KB
 * panel had inlined as `flex items-center gap-1.5` around a Lucide glyph (the
 * "Description" + EmbedStatus row, the "Suggested links" row) — the layout the
 * plain `RailSectionHeading` could not express, so those stayed raw. Promoting it
 * keeps the rendered markup IDENTICAL (an `h3` with the same base classes + the
 * `gap-1.5` icon flex) while removing the duplication. Mechanism only.
 *
 * `uppercase` adds the `tracking-wide uppercase` modifier some headings use; the
 * `icon` is rendered at the heading's small size by the caller; `trailing` fills
 * an `ml-auto` slot (e.g. an embed-status pill). Semantic tokens only — dark mode
 * is automatic; extra classes compose via `className`.
 */

export type SectionHeadingRowProps = React.ComponentPropsWithoutRef<'h3'> & {
  /** Leading glyph rendered to the left of the label (caller sets its size). */
  icon?: React.ReactNode;
  /** Trailing slot pinned to the right (e.g. a status pill). */
  trailing?: React.ReactNode;
  /** Add `tracking-wide uppercase` (canvas/panel uppercase headings). */
  uppercase?: boolean;
};

export function SectionHeadingRow({
  className,
  icon,
  trailing,
  uppercase = false,
  children,
  ...props
}: SectionHeadingRowProps) {
  return (
    <h3
      className={cn(
        'text-muted-foreground flex items-center gap-1.5 text-xs font-medium',
        uppercase && 'tracking-wide uppercase',
        className
      )}
      {...props}
    >
      {icon}
      {children}
      {trailing}
    </h3>
  );
}
