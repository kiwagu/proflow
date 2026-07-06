'use client';

import { Separator } from '@workspace/ui/components/separator';
import * as React from 'react';

/**
 * LensToolbar — the ONE shared lens "shelf" (toolbar) every lens composes (ADR-0025 §1,
 * lens-feature-component-reuse: parameterize-don't-fork). It owns the common frame (the
 * bordered bar + the `ml-auto` right-cluster) and renders the standard right-cluster
 * controls in ONE FIXED ORDER for EVERY lens, so a control defined once appears on every
 * lens by construction — never per-lens toolbar assembly.
 *
 * The `filter` slot (the cross-lens "Only files" chip) is FIRST in the right cluster with a
 * trailing vertical `Separator` splitting it from the view/layout controls — exactly as the
 * Drive lens rendered it inline. Because `filter` is a first-class prop, ANY lens that
 * passes it gets the chip in the SAME place: "chip everywhere" is automatic, not copied.
 *
 * PURELY presentational (ADR-0005 §b): no lens logic, no i18n inside — the caller passes
 * already-resolved nodes/strings for every slot. The `left` slot is the lens-specific left
 * region (Drive → breadcrumb/lens-label; Search → the search input). Each optional right
 * slot renders only when provided.
 */
export function LensToolbar({
  left,
  filter,
  selectAll,
  lensView,
  layout,
  upload,
  split,
  trailing,
}: {
  /** The lens-specific LEFT region (Drive breadcrumb / lens label, Search input). */
  left: React.ReactNode;
  /**
   * The cross-lens "Only files" filter chip — rendered FIRST in the right cluster with a
   * trailing vertical `Separator`, so every lens that passes it gets the chip in the SAME
   * place. Omit (undefined) on a lens where the filter does not apply (e.g. Trash).
   */
  filter?: React.ReactNode;
  /** The "select all visible" affordance (Drive multi-select, GRID/card renders — the
   * list layout carries its own header checkbox instead). A compact icon control grouped
   * with the view controls; omitted when there is nothing to select. */
  selectAll?: React.ReactNode;
  /** The Flat↔Advanced lens-view toggle (structural / search lenses). */
  lensView?: React.ReactNode;
  /** The grid↔list layout toggle. */
  layout: React.ReactNode;
  /** The Upload launcher (Drive content lenses). */
  upload?: React.ReactNode;
  /** The split-pane toggle (Drive kb-browse). */
  split?: React.ReactNode;
  /** Any bespoke trailing controls (e.g. the Drive clipboard chip). */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b px-5 py-3">
      {left}
      <div className="ml-auto flex items-center gap-1.5">
        {filter != null ? (
          <>
            {filter}
            <Separator orientation="vertical" className="mx-0.5 h-6" />
          </>
        ) : null}
        {trailing}
        {upload}
        {selectAll}
        {lensView}
        {layout}
        {split}
      </div>
    </div>
  );
}
