'use client';

import * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@workspace/ui/lib/utils';

/**
 * Progress — the shared shadcn/radix determinate progress bar. A track + a
 * filled indicator driven by a 0–100 `value`, used wherever a percentage of a
 * bounded operation must be shown (e.g. the KB media create-flow upload bar for
 * large resumable/TUS uploads). Prefer this over a hand-rolled bar
 * (ui-primitive-hygiene).
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-muted relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full',
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary size-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
