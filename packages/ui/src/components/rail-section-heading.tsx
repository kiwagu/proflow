import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * RailSectionHeading — the small muted section label used to head a group inside
 * a rail/panel/facet column (e.g. "Filters", "Tags", "Description"). It is the
 * repeated `<h3 class="text-muted-foreground text-xs font-medium">` heading the KB
 * views had inlined many times; promoting it to one primitive removes that
 * duplication while keeping the rendered markup IDENTICAL (an `h3` with the same
 * base classes). Mechanism-only — no domain meaning.
 *
 * Extra classes (e.g. `uppercase tracking-wide` for a canvas section) compose via
 * `className`; semantic tokens only, so dark mode is automatic.
 */

export type RailSectionHeadingProps = React.ComponentPropsWithoutRef<'h3'>;

export function RailSectionHeading({
  className,
  ...props
}: RailSectionHeadingProps) {
  return (
    <h3
      className={cn('text-muted-foreground text-xs font-medium', className)}
      {...props}
    />
  );
}
