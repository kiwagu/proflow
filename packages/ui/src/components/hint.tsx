'use client';

import * as React from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip';

/**
 * Hint — a thin, accessible tooltip wrapper for annotating a single control with
 * a short hover/focus hint. It composes the shadcn/Radix `Tooltip` primitives so
 * every hint in the app shares ONE styled, keyboard-reachable, portal-rendered
 * surface instead of a mix of native `title=` bubbles and ad-hoc markup.
 *
 * Best practices baked in:
 * - `asChild` trigger: the hint wraps the real control with NO extra DOM, so the
 *   control keeps its own accessible name (`aria-label`) — the hint is a visual
 *   affordance, not the accessibility source. Pass the SAME text you already put
 *   in `aria-label` so the two never drift.
 * - A short open delay (300ms) so hints don't flash on incidental pointer travel,
 *   yet feel instant on intent. Override per-instance via `delayDuration`.
 * - Graceful absence: with no `label` (or `hidden`), the child renders bare — the
 *   call site can pass a conditional label without branching the JSX.
 *
 * Requires a single `TooltipProvider` ancestor — exactly one per app/surface root
 * (the canonical Radix shape: the provider "wraps your app"). That shared provider is
 * what gives consistent open delay and skip-delay grouping, so neighbouring hints open
 * instantly in a sweep. In unit/integration tests render through the shared test-utils
 * `render` (it injects the provider) rather than wrapping per test.
 *
 * Use it ONLY for genuinely supplementary text. Don't hide essential information
 * behind a hint, and don't hint a control whose visible label already says it.
 */
export type HintProps = {
  /** The hint text. Mirror the control's `aria-label`. Empty → child renders bare. */
  label?: React.ReactNode;
  /** The control to annotate — rendered as the tooltip trigger (`asChild`). */
  children: React.ReactNode;
  /** Side the hint pops to. Default `top`. */
  side?: React.ComponentProps<typeof TooltipContent>['side'];
  /** Cross-axis alignment. Default `center`. */
  align?: React.ComponentProps<typeof TooltipContent>['align'];
  /** Gap (px) between control and hint. */
  sideOffset?: number;
  /** Open delay in ms. Default 300. */
  delayDuration?: number;
  /** Optional keyboard shortcut, shown as a `kbd` chip after the label. */
  keys?: string;
  /** Suppress the hint while still rendering the child. */
  hidden?: boolean;
  /** Extra classes for the hint content surface. */
  className?: string;
};

export function Hint({
  label,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 4,
  delayDuration = 300,
  keys,
  hidden = false,
  className,
}: HintProps) {
  if (hidden || label == null || label === '') {
    return <>{children}</>;
  }

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
      >
        {label}
        {keys ? <kbd data-slot="kbd">{keys}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
