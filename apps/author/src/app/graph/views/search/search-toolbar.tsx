'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Input } from '@workspace/ui/components/input';
import { Search } from 'lucide-react';

import {
  LayoutToggle,
  type DriveLayout,
} from '@/app/graph/views/drive/layout-toggle';
import { LensViewToggle } from '@/app/graph/views/drive/lens-view-toggle';
import type { LensView } from '@/app/graph/views/registry/projection-view.types';

/**
 * SearchToolbar — the search lens's toolbar row: the live search input plus the two
 * orthogonal display toggles (Flat↔Advanced lens view, Pro-gated; grid↔list layout). The
 * SAME `LensViewToggle` / `LayoutToggle` controls every other lens carries — never forked
 * here. Pure presentation: the caller owns term/layout/lens-view state. Behaviour-preserving.
 */
export function SearchToolbar({
  t,
  term,
  onInput,
  layout,
  onLayoutChange,
  lensView,
  onLensViewChange,
  advancedStructuralEntitled,
}: {
  t: GraphTranslator;
  term: string;
  onInput: (next: string) => void;
  layout: DriveLayout;
  onLayoutChange: (layout: DriveLayout) => void;
  lensView: LensView;
  onLensViewChange?: (view: LensView) => void;
  advancedStructuralEntitled: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b px-5 py-3">
      <div className="relative w-full max-w-[520px]">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          autoFocus
          value={term}
          onChange={(event) => onInput(event.target.value)}
          placeholder={t('graph.search.placeholder')}
          aria-label={t('graph.search.placeholder')}
          className="pl-9"
          data-testid="drive-search-input"
        />
      </div>
      <div className="ml-auto" />
      {/* The lens display-mode toggle (ADR-0022 Fork 4 + Addendum A) — the SAME
          Flat↔Advanced control the structural lenses carry; present + Pro-gated (the
          locked control IS the upsell). */}
      {onLensViewChange ? (
        <LensViewToggle
          t={t}
          lensView={lensView}
          onLensViewChange={onLensViewChange}
          entitled={advancedStructuralEntitled}
        />
      ) : null}
      {/* The grid/list LAYOUT toggle — the SAME control the Drive lenses carry. The layout
          axis is ORTHOGONAL to the lens-view axis: all four {flat,advanced}×{grid,list}
          combinations render. */}
      <LayoutToggle
        layout={layout}
        onLayoutChange={onLayoutChange}
        gridLabel={t('graph.drive.layoutGrid')}
        listLabel={t('graph.drive.layoutList')}
      />
    </div>
  );
}
