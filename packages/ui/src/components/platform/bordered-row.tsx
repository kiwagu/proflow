import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * BorderedRow — the bordered "name/slug on the left, a control or badge on the
 * right" row repeated across the platform account surfaces (space lists, pending
 * invites, support spaces). It is the `flex items-center justify-between rounded-md
 * border p-3` frame those sites each re-declared with drifted padding; promoting it
 * normalizes the padding to the canonical `p-3` while keeping content, order, ids,
 * badges and text identical.
 *
 * Mechanism only and i18n-free: the LEFT region is `children` (the caller composes
 * its own name + slug/description stack, since the inner spacing/typography differs
 * per site) and the RIGHT region is the `actions` slot (a badge, a button, or a
 * cluster). Background and any extra modifiers (`bg-muted/30`, `bg-background`,
 * `flex-wrap`, gap overrides) stay with the caller via `className`. `as` picks the
 * host element so a list item keeps rendering a real `<li>` (default `div`).
 * Semantic tokens only — dark mode is automatic.
 */
type BorderedRowProps = React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'li';
  actions?: React.ReactNode;
};

function BorderedRow({
  as: Component = 'div',
  className,
  children,
  actions,
  ...props
}: BorderedRowProps) {
  return (
    <Component
      className={cn(
        'border-border flex items-center justify-between gap-3 rounded-md border p-3',
        className
      )}
      {...props}
    >
      {children}
      {actions}
    </Component>
  );
}

export { BorderedRow };
export type { BorderedRowProps };
