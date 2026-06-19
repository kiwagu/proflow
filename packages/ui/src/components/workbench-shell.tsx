'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';
import { ResizableRail } from '@workspace/ui/components/resizable-rail';
import type { UseResizableWidthOptions } from '@workspace/ui/hooks/use-resizable-width';

/**
 * WorkbenchShell — the SINGLE sub-layout every workbench tab shares: the unified
 * left-panel chrome and the main-content inset. Mechanism-only (no domain
 * semantics): callers pass a `panel` descriptor + `main` children (and optionally a
 * `toolbar`); the shell renders the identical frame around whatever they supply, so
 * the tabs cannot drift apart.
 *
 * Spacing model (the panel-bg-to-the-edge rule): the shell root has NO outer
 * padding, so each region's BACKGROUND reaches the container edges flush — the gray
 * `bg-sidebar` panel meets the top/left/bottom borders, and the main `bg-background`
 * meets the right/bottom. Whitespace is INTERNAL to each region (panel padding +
 * main inset), so content never glues to the edges while the fills stay full-bleed.
 *
 * The left panel comes in two shapes that wear the SAME chrome (`bg-sidebar`,
 * `border-r`, internal padding, width convention): a `resizable` rail (drag handle
 * via the shared `ResizableRail`) and a `fixed`-width sidebar. The shell owns the
 * chrome; the caller owns only the panel's CONTENT — so a resizable rail and a
 * fixed sidebar look pixel-identical apart from the resize affordance.
 *
 * The `toolbar` slot is for tabs whose "panel" is a top strip rather than a side
 * column (e.g. a spatial map's trail/filter controls); it spans the content region
 * within the same shell frame so that tab is consistent too. A tab may also
 * opt its main region into `bleed` (no inner padding) when its content paints to its
 * own edges (e.g. a full-bleed canvas with its own floating controls).
 *
 * Styled strictly through semantic tokens — dark mode is automatic.
 */

/** Unified left-panel chrome shared by both panel shapes. */
const PANEL_CHROME = 'bg-sidebar flex flex-col border-r';
/** Internal panel padding (one convention for every tab's panel). */
const PANEL_PADDING = 'px-3 py-3';

export type WorkbenchPanel =
  | {
      kind: 'resizable';
      children: React.ReactNode;
      options: UseResizableWidthOptions;
      'aria-label'?: string;
      className?: string;
    }
  | {
      kind: 'fixed';
      children: React.ReactNode;
      width: number;
      'aria-label'?: string;
      className?: string;
    };

export type WorkbenchShellProps = Readonly<{
  /** Optional left panel (resizable rail or fixed sidebar) in the unified chrome. */
  panel?: WorkbenchPanel;
  /** Optional top toolbar strip (for tabs whose controls live across the top). */
  toolbar?: React.ReactNode;
  /** The main content region (canvas / reader / map). */
  main: React.ReactNode;
  /** Drop the main region's inner padding for content that paints to its own edges. */
  bleed?: boolean;
  className?: string;
}>;

/** The unified left-panel region — same chrome for both shapes. */
function WorkbenchShellPanel({ panel }: { panel: WorkbenchPanel }) {
  if (panel.kind === 'resizable') {
    return (
      <ResizableRail
        options={panel.options}
        aria-label={panel['aria-label']}
        className={cn(PANEL_CHROME, panel.className)}
        bodyClassName={PANEL_PADDING}
      >
        {panel.children}
      </ResizableRail>
    );
  }
  return (
    <nav
      aria-label={panel['aria-label']}
      style={{ width: `${panel.width}px` }}
      className={cn(
        PANEL_CHROME,
        PANEL_PADDING,
        'shrink-0 overflow-y-auto',
        panel.className
      )}
    >
      {panel.children}
    </nav>
  );
}

export function WorkbenchShell({
  panel,
  toolbar,
  main,
  bleed,
  className,
}: WorkbenchShellProps) {
  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', className)}
    >
      {panel ? <WorkbenchShellPanel panel={panel} /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            bleed ? 'overflow-hidden' : 'px-5 py-4'
          )}
        >
          {main}
        </div>
      </div>
    </div>
  );
}
