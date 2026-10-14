'use client';

import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';

import { cn } from '@workspace/ui/lib/utils';

/**
 * ScrollArea — the shared scroll primitive (shadcn/radix). A bounded-height,
 * styled overflow region with a custom scrollbar, used wherever a list must stay
 * within a max-height and scroll its overflow rather than grow its container (e.g.
 * the ResourcePanel's read-only "Access" grantee / inherited-folder lists).
 * Prefer this over a raw `overflow-y:auto` div (ui-primitive-hygiene).
 */
function ScrollArea({
  className,
  children,
  viewportRef,
  viewportProps,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /**
   * The element that actually scrolls. Radix owns it, so a caller that has to
   * read or move the scroll position (a transcript that follows a streaming
   * reply, a list that restores its offset) reaches it through here instead
   * of re-implementing the primitive around a raw overflow div.
   */
  viewportRef?: React.Ref<HTMLDivElement>;
  /** Extra props for that same element — `onScroll`, `aria-*`, a test id. */
  viewportProps?: React.ComponentProps<'div'> &
    Record<`data-${string}`, string>;
}) {
  const { className: viewportClassName, ...restViewportProps } =
    viewportProps ?? {};
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        className={cn(
          'focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1',
          viewportClassName
        )}
        {...restViewportProps}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
