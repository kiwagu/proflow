'use client';

import { LayoutGrid, List } from 'lucide-react';
import * as React from 'react';

import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';

/** The grid/list display layout — a per-device UI preference. */
export type LayoutMode = 'grid' | 'list';

/**
 * LayoutToggle — the shared grid ↔ list display-layout segmented control. Generic and
 * i18n-free: the caller passes resolved `gridLabel` / `listLabel` strings and owns the
 * `layout` state. Grid = the card tiles; list = the data table.
 */
export function LayoutToggle({
  layout,
  onLayoutChange,
  gridLabel,
  listLabel,
}: {
  layout: LayoutMode;
  onLayoutChange: (layout: LayoutMode) => void;
  gridLabel: string;
  listLabel: string;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border">
      <Hint label={gridLabel}>
        <Button
          type="button"
          variant="segmented"
          onClick={() => onLayoutChange('grid')}
          aria-label={gridLabel}
          aria-pressed={layout === 'grid'}
          className="grid h-7 w-[30px] place-items-center p-0"
        >
          <LayoutGrid className="size-[15px]" aria-hidden />
        </Button>
      </Hint>
      <Hint label={listLabel}>
        <Button
          type="button"
          variant="segmented"
          onClick={() => onLayoutChange('list')}
          aria-label={listLabel}
          aria-pressed={layout === 'list'}
          className="grid h-7 w-[30px] place-items-center p-0"
        >
          <List className="size-[15px]" aria-hidden />
        </Button>
      </Hint>
    </div>
  );
}
