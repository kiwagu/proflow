import type * as React from 'react';

// Grid = flex-wrap of FIXED-width cards (NOT a `1fr` grid): card width must stay
// constant whether a side panel is open or closed — `1fr`/`minmax` would restretch
// every card when the available width changes, so the icons/tiles visibly jump. With a
// fixed basis (`shrink-0` so two-up rows never squeeze), a width change only reflows the
// column COUNT (pure flex), never the card size — and EVERY kind shares this one width,
// so they line up. Cards left-align; trailing space is fine. Width is generous so longer
// titles stay readable before they truncate.
export const GRID_CARD = 'w-[264px] shrink-0';
export const GRID_WRAP = 'flex flex-wrap gap-2.5';
export const LIST_WRAP = 'flex flex-col gap-1.5';

// Hover-reveal classes for a card's `⋯` action trigger (stays visible while open). Also
// pins the trigger to `size-7` — the SAME footprint as the rail's star button (the default
// `icon-sm` is `size-8`, 4px wider, which drifts the wider button's center left of the star
// under the rail's `items-end`). Equal widths → right-aligned edges AND aligned centers, so
// the star + `⋯` share one vertical axis while the star stays flush at the far corner.
export const CARD_ACTION_TRIGGER =
  'size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';

/**
 * CardActionRail — the per-card "command" controls (e.g. star + `⋯` menu + reveal), unified
 * across EVERY card lens. INVARIANT: the STAR sits at the FAR CORNER in either orientation —
 * the TOP of the vertical rail (grid, = top-right corner) and the RIGHTMOST of the horizontal
 * rail (list rows, via `flex-row-reverse`). Grid = vertical (~1 button wide, keeps the title
 * width); list rows = horizontal + vertically centered so the rail fits the short row. Both
 * slots are opaque `ReactNode`, so the caller owns the actual buttons (i18n / domain).
 */
export function CardActionRail({
  star,
  actions,
  list = false,
}: {
  star?: React.ReactNode;
  actions?: React.ReactNode;
  list?: boolean;
}) {
  if (!star && !actions) {
    return null;
  }
  return (
    <div
      className={
        list
          ? 'absolute inset-y-0 right-2 flex flex-row-reverse items-center gap-0.5'
          : 'absolute top-2 right-2 flex flex-col items-end gap-0.5'
      }
    >
      {star}
      {actions}
    </div>
  );
}
