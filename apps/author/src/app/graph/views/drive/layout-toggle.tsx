'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { LayoutGrid, List } from 'lucide-react';
import * as React from 'react';

/** The grid/list display layout — a per-device UI preference (the `drive-layout` cookie). */
export type DriveLayout = 'grid' | 'list';

/**
 * LayoutToggle — the shared grid ↔ list display-layout segmented control. The SAME
 * two-icon toggle the Drive lenses and the lexical-search lens carry, lifted here so
 * the identical JSX is not inlined at each call-site (ui-primitive-hygiene). Mirrors
 * `LensViewToggle`.
 *
 * Pure presentation: the caller owns the `layout` state (seeded from the server-read
 * `drive-layout` cookie so the SSR'd layout matches the first client render) and writes
 * the cookie back in `onLayoutChange`. Grid = the card tiles; list = the data table.
 */
export function LayoutToggle({
  t,
  layout,
  onLayoutChange,
}: {
  t: GraphTranslator;
  layout: DriveLayout;
  onLayoutChange: (layout: DriveLayout) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border">
      <Hint label={t('graph.drive.layoutGrid')}>
        <Button
          type="button"
          variant="segmented"
          onClick={() => onLayoutChange('grid')}
          aria-label={t('graph.drive.layoutGrid')}
          aria-pressed={layout === 'grid'}
          className="grid h-7 w-[30px] place-items-center p-0"
        >
          <LayoutGrid className="size-[15px]" aria-hidden />
        </Button>
      </Hint>
      <Hint label={t('graph.drive.layoutList')}>
        <Button
          type="button"
          variant="segmented"
          onClick={() => onLayoutChange('list')}
          aria-label={t('graph.drive.layoutList')}
          aria-pressed={layout === 'list'}
          className="grid h-7 w-[30px] place-items-center p-0"
        >
          <List className="size-[15px]" aria-hidden />
        </Button>
      </Hint>
    </div>
  );
}
