'use client';

import { RowActionButton } from '@workspace/ui/components/platform/row-action-button';
import { cn } from '@workspace/ui/lib/utils';
import { Star, Target } from 'lucide-react';
import * as React from 'react';

// Grid = flex-wrap of FIXED-width cards (NOT a `1fr` grid): card width must stay
// constant whether the Details panel is open or closed — `1fr`/`minmax` would
// restretch every card when the available width changes, so the icons/tiles
// visibly jump. With a fixed basis (`shrink-0` so two-up rows never squeeze), a
// width change only reflows the column COUNT (pure flex), never the card size —
// and EVERY kind (folder, document, file) shares this one width, so they line up.
// Cards left-align; trailing space is fine. Width is generous so longer titles
// stay readable before they truncate.
export const GRID_CARD = 'w-[264px] shrink-0';
export const GRID_WRAP = 'flex flex-wrap gap-2.5';
export const LIST_WRAP = 'flex flex-col gap-1.5';

// Hover-reveal classes for a card's `⋯` action trigger (stays visible while open).
export const CARD_ACTION_TRIGGER =
  'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';

// Single vs double click on a card (the Google-Drive split): single click opens
// the shared Details panel, double click OPENS the node (folder → navigate in,
// document → read-view). A lone click defers to Details on a short timer so a
// double-click can cancel it — opening never flashes the Details panel first.
// Keyboard Enter on the card button fires a `detail === 0` click, so it lands on
// Details (the safe, reversible action); opening by keyboard is one Enter further,
// from the panel.
//
// Discrimination is on the click's running count (`event.detail`), NOT the separate
// `dblclick` event: the 2nd click of a pair arrives as `detail === 2` and Opens
// directly. Relying on `dblclick` was fragile — the browser drops it whenever a
// re-render swaps the card element between the two clicks (e.g. the reader's
// focus-refetch firing after the editor round-trip), which silently degraded the
// split. There is also no long-lived "armed" flag to wedge: each click cancels and
// reschedules its own pending Details, so the split can never fall back to
// open-on-single-click.
const CARD_DOUBLE_CLICK_MS = 250;

export function useCardOpen(onDetails: () => void, onOpen: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  React.useEffect(() => cancel, [cancel]);
  return {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 1) {
        cancel(); // 2nd click of a pair → Open, drop the pending Details.
        onOpen();
        return;
      }
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        onDetails();
      }, CARD_DOUBLE_CLICK_MS);
    },
  };
}

/** Merge dnd-kit's draggable + droppable refs onto one element (folders are both). */
export function useMergedRef(
  a?: (el: HTMLElement | null) => void,
  b?: (el: HTMLElement | null) => void
) {
  return React.useCallback(
    (el: HTMLElement | null) => {
      a?.(el);
      b?.(el);
    },
    [a, b]
  );
}

/** Drag/drop wiring a card applies to its outer wrapper (the workbench owns the
 * DndContext; the cards just mark themselves draggable / droppable). */
export type CardDnd = {
  /** Combined draggable+droppable ref + listeners/attributes for the wrapper. */
  setRef?: (el: HTMLElement | null) => void;
  listeners?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  /** This card is the source being dragged (dim it). */
  dragging?: boolean;
  /** A valid drag is hovering this folder (highlight as the active drop target). */
  dropOver?: boolean;
  /** A drag is in progress and this folder is a VALID landing zone — show a quiet
   * "you can drop here" affordance (distinct from the stronger `dropOver` hover). */
  candidate?: boolean;
};

/**
 * The per-node star toggle (the only per-user write the Drive surface owns today).
 * On a card it reveals on hover when unstarred — like the ⋯ menu — and stays solid
 * amber once starred so the Starred set reads at a glance; `alwaysShow` keeps it
 * visible inside the table rows, which carry no hover-reveal group.
 */
export function StarButton({
  starred,
  onToggle,
  label,
  alwaysShow,
}: {
  starred: boolean;
  onToggle: () => void;
  label: string;
  alwaysShow?: boolean;
}) {
  // Thin domain wrapper over the shared RowActionButton (single source of truth for the
  // row-action style). `active`/`alwaysShow` force the button visible; otherwise it
  // hover-reveals like the ⋯ menu. The amber fill (when starred) lives on the icon — the
  // shared button governs chrome + reveal, not the star's domain treatment. Note the hover
  // is now the STRONG one (darker fill + foreground), matching the other row actions.
  return (
    <RowActionButton
      label={label}
      aria-pressed={starred}
      onActivate={onToggle}
      reveal={alwaysShow ? 'always' : 'hover'}
      active={starred}
      hint={false}
    >
      <Star
        className={cn(
          'size-4',
          starred ? 'fill-amber-400 text-amber-400' : undefined
        )}
        aria-hidden
      />
    </RowActionButton>
  );
}

/**
 * RevealInKbButton — a small inline action that sits next to the star and jumps to this
 * resource's position in the KB containment tree (the 'kb' lens at its parent folder).
 * Hover-revealed like the other card actions; the same affordance lives in the `⋯` menu
 * ("Open in KB") for surfaces without a star. A thin domain wrapper over the shared
 * RowActionButton (the same `Target` "open in KB" jump the search lens's OpenInKbButton is).
 */
export function RevealInKbButton({
  onReveal,
  label,
}: {
  onReveal: () => void;
  label: string;
}) {
  return (
    <RowActionButton
      label={label}
      onActivate={onReveal}
      reveal="hover"
      hint={false}
    >
      <Target className="size-4" aria-hidden />
    </RowActionButton>
  );
}

/**
 * CardActionRail — the per-card "command" controls (star + `⋯` menu + reveal-in-KB), unified
 * across EVERY card lens. INVARIANT: the STAR sits at the FAR CORNER in either orientation —
 * the TOP of the vertical rail (grid, = top-right corner) and the RIGHTMOST of the horizontal
 * rail (list rows, via `flex-row-reverse`). Grid = vertical (~1 button wide, keeps the title
 * width); list rows = horizontal + vertically centered so the rail fits the short row.
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

export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground mb-2 text-xs font-semibold tracking-[0.04em] uppercase',
        className
      )}
    >
      {children}
    </div>
  );
}
