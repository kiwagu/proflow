'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';
import {
  useResizableWidth,
  type UseResizableWidthOptions,
} from '@workspace/ui/hooks/use-resizable-width';

/**
 * ResizableRail — a generic left rail with a drag-to-resize divider on its right
 * edge, width persisted via `use-resizable-width`. Mechanism-only: it renders
 * whatever children the caller supplies and exposes no domain semantics.
 *
 * The divider is a thin 1px hairline in `--border` (the system's defining
 * texture) with a slightly wider invisible hit area; it shifts to `--ring` while
 * dragging. Styled strictly through semantic tokens — no inline color.
 */

export type ResizableRailProps = {
  children: React.ReactNode;
  options: UseResizableWidthOptions;
  className?: string;
  'aria-label'?: string;
};

export function ResizableRail({
  children,
  options,
  className,
  'aria-label': ariaLabel,
}: ResizableRailProps) {
  const { width, resizing, startResize } = useResizableWidth(options);

  return (
    <div
      aria-label={ariaLabel}
      className={cn('relative shrink-0', className)}
      style={{ width: `${width}px` }}
    >
      <div className="h-full overflow-y-auto pr-3">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize items-stretch justify-center"
      >
        <span
          className={cn(
            'bg-border w-px transition-colors',
            resizing && 'bg-ring'
          )}
          aria-hidden
        />
      </div>
    </div>
  );
}
