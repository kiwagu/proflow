import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/**
 * LabeledStatusRow — a muted, bordered row pairing a left `label` with a right-aligned
 * status slot (`children`, typically a Badge or a muted value span). Generic and
 * i18n-free: the caller passes a resolved `label` string and any `data-testid` via
 * spread props. The settings sections use it to lay out resolution/gate readouts.
 */
function LabeledStatusRow({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { label: React.ReactNode }) {
  return (
    <div
      className={cn(
        'bg-muted/30 border-border flex items-center justify-between rounded-md border px-3 py-2',
        className
      )}
      {...props}
    >
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

export { LabeledStatusRow };
