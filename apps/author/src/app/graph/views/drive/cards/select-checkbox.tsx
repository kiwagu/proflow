'use client';

import { Checkbox } from '@workspace/ui/components/checkbox';
import { cn } from '@workspace/ui/lib/utils';
import * as React from 'react';

/**
 * SelectCheckbox — the per-card multi-select control (release-hardening B2). On a grid
 * card it sits in the BOTTOM-RIGHT corner — clear of both the leading kind icon (which a
 * top-left box overlapped) and the star/`⋯` rail the CardActionRail keeps at the top; on
 * a list row it overlays the leading kind icon. Revealed on hover (the `group` on the
 * card wrapper) OR while selected, exactly like the star. On a Trash card (which has no
 * star and no hover-reveal group) it renders INLINE and always-visible, matching the
 * always-on Restore / Delete buttons.
 *
 * Clicking it toggles selection and MUST NOT open the Details drawer, so it stops
 * propagation (it is a sibling of the clickable CardTile). SHIFT-click is detected off
 * the click event and forwarded so the caller can select a contiguous range. The box is
 * fully CONTROLLED by the selection set (`checked`), so no `onCheckedChange` — the click
 * drives the shared model, the prop drives the visual.
 */
export function SelectCheckbox({
  checked,
  onToggle,
  label,
  placement = 'grid',
}: {
  checked: boolean;
  /** Toggle this card's selection; `shiftKey` requests a contiguous range select. */
  onToggle: (shiftKey: boolean) => void;
  label: string;
  /**
   * `grid` (default) — bottom-right corner overlay; `list` — overlay the leading icon of
   * a list-row card; `inline` — a plain always-visible box the caller positions (Trash).
   */
  placement?: 'grid' | 'list' | 'inline';
}) {
  const box = (
    <Checkbox
      checked={checked}
      aria-label={label}
      // Stop the pointer-down from reaching the card's dnd drag listeners (which live on
      // the draggable wrapper this box sits inside) — otherwise a press on the checkbox
      // could START a drag instead of toggling selection (the "sensors must not hijack
      // interactive children" trap). Click still fires and drives the toggle.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event.shiftKey);
      }}
      className={cn(
        'bg-background/90 shadow-sm',
        placement !== 'inline' &&
          !checked &&
          'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
      )}
    />
  );

  if (placement === 'inline') {
    return box;
  }

  return (
    <div
      className={cn(
        'absolute z-10',
        placement === 'list'
          ? 'top-1/2 left-3.5 -translate-y-1/2'
          : 'right-2 bottom-2'
      )}
    >
      {box}
    </div>
  );
}
