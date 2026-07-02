'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { GRID_WRAP } from '@workspace/ui/components/platform/card-action-rail';
import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import { LensListTable } from '@/app/graph/views/drive';
import {
  LensTreeGrid,
  type LensTreeNode,
} from '@/app/graph/views/drive/lens-tree-grid';
import { artifactBytes } from '@/app/graph/views/drive/uploaded-artifacts';

import type { SearchRenderers } from './use-search-renderers';
import type { SearchResultsState } from './use-search-results';

// A stable empty default-sorting reference — the search list keeps the server rank order
// (no column default sort), and a fresh literal each render would thrash the table's memo.
const SEARCH_LIST_NO_SORT: { id: string; desc: boolean }[] = [];

/**
 * SearchResults — the search lens's results region: the idle/loading/empty prompts and the
 * {flat | advanced} × {grid | list} render branches. It renders every result through the
 * SAME shared leaves every lens uses — the Drive `ItemCard` (grid, via the renderers), the
 * shared `LensListTable` (list, flat + the force-expanded advanced tree), and `LensTreeGrid`
 * (the advanced grid) — never a forked renderer. Pure composition over the data state +
 * the render builders. Behaviour-preserving: identical empty-state gating, testids, table
 * keys, and the advanced/flat × grid/list selection the view held inline.
 */
export function SearchResults({
  t,
  results,
  renderers,
  selectedId,
  onRevealInKb,
}: {
  t: GraphTranslator;
  results: SearchResultsState;
  renderers: SearchRenderers;
  selectedId?: string;
  onRevealInKb?: (nodeId: string) => void;
}) {
  const {
    items: sortedItems,
    loading,
    resolved,
    tooShort,
    trimmed,
    layout,
    isAdvanced,
    searchTree,
    metaByItem,
    currentUserId,
  } = results;
  const { attributesByItem } = results;
  const { renderCard, renderTreeLeaf, listRows, snippetSlot } = renderers;

  // The Size column for the shared list table (ADR-0026 render) — a leaf's own uploaded-
  // artifact bytes, off the SAME `artifactBytes` helper the Drive lens uses (one meaning of
  // "size" across lenses). Search results are mostly flat leaves; a folder in the advanced
  // ancestor tree lacks a recursive size context here, so it shows "—" (deliberate — the
  // recursive folder-size roll-up is Drive-only; search does not walk a full containment
  // slice). Consistent LEAF sizes across lenses is the win.
  const sizeOf = React.useCallback(
    (node: LensNode): number | null =>
      node.kind === 'folder'
        ? null
        : artifactBytes(node, attributesByItem[node.id]),
    [attributesByItem]
  );

  // The shared list table — the ONE place the {flat | advanced} × list axis renders, with
  // the search snippet column + the reveal action per row. `tree`/`expansion:'always'`
  // force-unfolds the advanced ancestor tree; the flat list passes neither (a flat table).
  const listTable = (
    <div data-testid="drive-search-table">
      <LensListTable
        key={isAdvanced ? 'search-tree' : 'search-flat'}
        rows={listRows}
        tree={isAdvanced}
        expansion="always"
        t={t}
        metaByItem={metaByItem}
        currentUserId={currentUserId}
        selectedId={selectedId}
        // Search has no star / Recent / DnD / shared-badge column — the fail-safe defaults
        // (star omitted entirely, ADR-0025 §1 `star?` off).
        recentOpenedAt={null}
        defaultSorting={SEARCH_LIST_NO_SORT}
        snippet={snippetSlot}
        // The Size column — a leaf's own artifact bytes (folders "—"), off the shared
        // `artifactBytes`, so the size column reads consistently across lenses.
        sizeOf={sizeOf}
      />
    </div>
  );

  return (
    <div data-testid="drive-search-results">
      {tooShort ? (
        <EmptyState>{t('graph.search.idle')}</EmptyState>
      ) : loading && sortedItems.length === 0 ? (
        <EmptyState>{t('graph.search.searching')}</EmptyState>
      ) : resolved && sortedItems.length === 0 ? (
        <EmptyState data-testid="drive-search-empty">
          {t('graph.search.noResults', { term: trimmed })}
        </EmptyState>
      ) : isAdvanced ? (
        // Advanced (extended) = a FILTERED KB: the matched leaves placed in their
        // FULLY-EXPANDED ancestor-folder tree (the SAME containment tree the KB / Shared
        // advanced lens renders), at UNBOUNDED depth, with the snippet highlight on the
        // matched leaves. Grid = nested folder sections + leaf cards; list = ONE aligned,
        // depth-indented force-expanded table. The `drive-search-groups` wrapper is retained.
        <div data-testid="drive-search-groups">
          {layout === 'list' ? (
            listTable
          ) : (
            <LensTreeGrid
              roots={searchTree as LensTreeNode[]}
              renderLeaf={renderTreeLeaf}
              // Every breadcrumb path folder reveals itself in the KB on click (the crumb IS
              // the per-folder jump affordance — no separate icon).
              onJumpToFolder={onRevealInKb}
              folderTestId="drive-search-tree-folder"
            />
          )}
        </div>
      ) : layout === 'list' ? (
        listTable
      ) : (
        <div className={GRID_WRAP}>{sortedItems.map(renderCard)}</div>
      )}
    </div>
  );
}
