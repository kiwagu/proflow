'use client';

import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { cn } from '@workspace/ui/lib/utils';
import * as React from 'react';

/**
 * RowActionButton — the SINGLE source of truth for the small `size-7` ghost
 * icon-button that sits on a list/grid row (star, "open in KB" jump, and similar
 * per-row affordances). Every Drive/search row action used to copy-paste the same
 * className cluster, so a visual tweak had to be made in 2–3 files at once; this
 * owns that style ONCE so the row-action look lives in a single place.
 *
 * PLATFORM-flavoured but PRESENTATION-only: it carries NO i18n/domain dependency
 * (the caller passes `label` text + the icon + the handler), so it can back any
 * surface's row actions. Domain wrappers (the Drive star, the "open in KB" jump)
 * stay in the app and configure this with props. Lives under `components/platform/`
 * — app-flavoured shared UI, kept apart from the domain-neutral shadcn primitives.
 *
 * The canonical hover is the STRONG one: a clearly darker fill (`bg-foreground/15`)
 * + the icon darkening from muted to full foreground, so the action reads as a
 * distinct command even though the row itself highlights on hover.
 *
 * Props cover every existing call-site without leaking any domain specifics:
 * - `icon` (or `children`): the lucide glyph to render (size-4, aria-hidden).
 * - `label`: drives BOTH the `aria-label` AND an optional `Hint` tooltip mirroring
 *   it (per `ui-hints-tooltips`); pass `hint={false}` to suppress the tooltip while
 *   keeping the accessible name.
 * - `onActivate`: the click handler — the component does the `event.stopPropagation()`
 *   ITSELF (a row action must never also fire the row's own open/Details), so callers
 *   stop repeating it.
 * - `reveal`: `'always'` (default) keeps the button visible; `'hover'` hover-reveals
 *   it (opacity-0 → group-hover/focus-visible:opacity-100) for grid-card corners that
 *   have a hover group. (Menu `⋯` triggers that also need `data-[state=open]:opacity-100`
 *   keep their own reveal class — this is for plain buttons.)
 * - `active`: an on/off state (e.g. the star is starred). When `active`, the button
 *   stays visible (opacity-100) even under `reveal='hover'` so an active toggle reads
 *   at a glance. The icon's own colour/fill is the CALLER's (pass a pre-styled glyph,
 *   e.g. `fill-amber-400` when starred) — this component governs button chrome +
 *   reveal, not the icon's domain treatment.
 * - Plus pass-through `data-testid`, `aria-pressed`, and `className` (merged via `cn`).
 */

// Hover-reveal for a plain row action: hidden until the row's hover group is hovered
// or the control is focused. (The `⋯` menu trigger additionally needs
// `data-[state=open]:opacity-100` to stay visible while its menu is open — that
// variant stays at its own call-site; this is the plain-button reveal.)
const HOVER_REVEAL =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100';

export type RowActionButtonProps = {
  /** The icon glyph (rendered at size-4, aria-hidden). Alias for `children`. */
  icon?: React.ReactNode;
  /** The icon glyph (rendered at size-4, aria-hidden). */
  children?: React.ReactNode;
  /** Accessible name; also the `Hint` tooltip text unless `hint={false}`. */
  label: string;
  /** Show the `Hint` tooltip mirroring `label`. Default `true`. */
  hint?: boolean;
  /** Click handler — `event.stopPropagation()` is applied before it runs. */
  onActivate: () => void;
  /** Visibility: `'always'` (default) or `'hover'` (hover/focus-revealed). */
  reveal?: 'hover' | 'always';
  /** On/off state (e.g. star filled). Forces visible even under `reveal='hover'`. */
  active?: boolean;
  /** Mirrors `aria-pressed` for toggle semantics. */
  'aria-pressed'?: boolean;
  /** Test hook for e2e/screenshot probes. */
  'data-testid'?: string;
  /** Extra classes merged onto the button. */
  className?: string;
};

export function RowActionButton({
  icon,
  children,
  label,
  hint = true,
  onActivate,
  reveal = 'always',
  active = false,
  className,
  ...rest
}: RowActionButtonProps) {
  const glyph = icon ?? children;
  const button = (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      aria-pressed={rest['aria-pressed']}
      data-testid={rest['data-testid']}
      onClick={(event) => {
        // A row action is ADDITIVE — never also fire the row's open / Details.
        event.stopPropagation();
        onActivate();
      }}
      className={cn(
        // The single source of truth for the row-action icon-button look: the STRONG
        // hover (darker fill + icon darkens muted → foreground) so it reads as a
        // distinct command against the row's own hover highlight.
        'text-muted-foreground hover:bg-foreground/15 hover:text-foreground grid size-7 shrink-0 place-items-center rounded-md p-0',
        reveal === 'hover' && !active && HOVER_REVEAL,
        className
      )}
    >
      {glyph}
    </Button>
  );
  return hint ? <Hint label={label}>{button}</Hint> : button;
}
