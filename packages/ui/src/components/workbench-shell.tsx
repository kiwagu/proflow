'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

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
 * The left panel is a `fixed`-width sidebar in that unified chrome; the main region
 * carries the inner inset. Styled strictly through semantic tokens — dark mode is
 * automatic.
 */

/** Unified left-panel chrome. */
const PANEL_CHROME = 'bg-sidebar flex flex-col border-r';
/** Internal panel padding (one convention for every tab's panel). */
const PANEL_PADDING = 'px-3 py-3';

export type WorkbenchPanel = {
  kind: 'fixed';
  children: React.ReactNode;
  width: number;
  'aria-label'?: string;
  className?: string;
};

export type WorkbenchShellProps = Readonly<{
  /** Optional fixed-width left sidebar in the unified chrome. */
  panel?: WorkbenchPanel;
  /** Optional top toolbar strip (for tabs whose controls live across the top). */
  toolbar?: React.ReactNode;
  /** The main content region (canvas / reader / map). */
  main: React.ReactNode;
  className?: string;
}>;

/** The unified left-panel region. */
function WorkbenchShellPanel({ panel }: { panel: WorkbenchPanel }) {
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
  className,
}: WorkbenchShellProps) {
  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', className)}
    >
      {panel ? <WorkbenchShellPanel panel={panel} /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{main}</div>
      </div>
    </div>
  );
}
