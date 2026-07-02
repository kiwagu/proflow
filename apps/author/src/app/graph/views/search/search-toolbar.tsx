'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Input } from '@workspace/ui/components/input';
import { ToggleChip } from '@workspace/ui/components/toggle-chip';
import { FileUp, Search } from 'lucide-react';

import {
  LayoutToggle,
  type DriveLayout,
} from '@/app/graph/views/drive/layout-toggle';
import { LensViewToggle } from '@/app/graph/views/drive/lens-view-toggle';
import { LensToolbar } from '@/app/graph/views/lens-toolbar';
import type { LensView } from '@/app/graph/views/registry/projection-view.types';

/**
 * SearchToolbar — the search lens's shelf, assembled through the SHARED `LensToolbar` (NOT a
 * forked toolbar row). The `left` slot is the live search input; the standard right-cluster
 * controls come from the SAME props/order every other lens uses — the "Only files" filter
 * chip (`ToggleChip`, FIRST + separator, exactly as Drive), the Flat↔Advanced lens
 * view (Pro-gated), and the grid↔list layout toggle. The chip appears on Search purely by
 * passing it to the shared shelf's `filter` prop — no per-lens toolbar assembly.
 *
 * Pure presentation: the caller owns term/layout/lens-view/uploaded-only state.
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
  uploadedOnly,
  onUploadedOnlyChange,
}: {
  t: GraphTranslator;
  term: string;
  onInput: (next: string) => void;
  layout: DriveLayout;
  onLayoutChange: (layout: DriveLayout) => void;
  lensView: LensView;
  onLensViewChange?: (view: LensView) => void;
  advancedStructuralEntitled: boolean;
  /** The cross-lens "Only files" filter state (ADR-0026 render) — the SAME chip Drive shows. */
  uploadedOnly: boolean;
  /** Toggle the "Only files" filter — the view holds the state + narrows the result set. */
  onUploadedOnlyChange: (next: boolean) => void;
}) {
  return (
    <LensToolbar
      left={
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
      }
      // The cross-lens "Only files" chip — the SAME control (icon, label, hint) the Drive
      // shelf renders, now on Search by passing it as the shared toolbar's `filter` prop.
      filter={
        <ToggleChip
          label={t('graph.drive.filterUploaded')}
          pressed={uploadedOnly}
          onPressedChange={onUploadedOnlyChange}
          icon={FileUp}
          hint={t('graph.drive.folderSizeHint')}
        />
      }
      // The lens display-mode toggle (ADR-0022 Fork 4 + Addendum A) — the SAME Flat↔Advanced
      // control the structural lenses carry; present + Pro-gated (the locked control IS the
      // upsell).
      lensView={
        onLensViewChange ? (
          <LensViewToggle
            t={t}
            lensView={lensView}
            onLensViewChange={onLensViewChange}
            entitled={advancedStructuralEntitled}
          />
        ) : undefined
      }
      // The grid/list LAYOUT toggle — the SAME control the Drive lenses carry. The layout
      // axis is ORTHOGONAL to the lens-view axis: all four {flat,advanced}×{grid,list}
      // combinations render.
      layout={
        <LayoutToggle
          layout={layout}
          onLayoutChange={onLayoutChange}
          gridLabel={t('graph.drive.layoutGrid')}
          listLabel={t('graph.drive.layoutList')}
        />
      }
    />
  );
}
