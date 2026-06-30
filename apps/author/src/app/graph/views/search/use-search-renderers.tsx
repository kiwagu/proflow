'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { type SearchResultItem } from '@workspace/knowledge-contracts';
import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import { ItemCard, type DriveRow } from '@/app/graph/views/drive';

import { OpenInKbButton } from './open-in-kb-button';
import type { SearchActivation } from './use-search-activation';
import type { SearchResultsState } from './use-search-results';
import { SearchSnippet } from './search-snippet';
import type { SearchTreeNode } from './search-tree';

/**
 * The render builders the search lens feeds its shared leaves — the ONE place a hit is
 * turned into a Drive `ItemCard` (grid) or a `DriveRow` (list), plus the per-row "Open in
 * KB" reveal and the list snippet column. Lifted off `SearchView` so the {flat | advanced}
 * × {grid | list} render branches never re-derive a card/row/cell (lens-feature-component-reuse):
 * every combination renders through these SAME builders, so the modes can't drift. Pure —
 * it composes the shared Drive leaves with the search delta (snippet + reveal); it never
 * forks them. Behaviour-preserving: the same props, memo deps, and folder/leaf row shapes
 * the view held inline.
 */
export type SearchRenderers = {
  /** Render ONE search-result card (flat grid + every advanced grid leaf). */
  renderCard: (item: SearchResultItem) => React.ReactElement;
  /** Render a content LEAF of the advanced grid forest (reuses `renderCard`). */
  renderTreeLeaf: (node: LensNode) => React.ReactElement | null;
  /** The list rows: flat = ranked hits; advanced = the forest mapped with `subRows`. */
  listRows: DriveRow[];
  /** The list table's snippet column slot (matched excerpt, live-term highlighted). */
  snippetSlot: {
    header: string;
    cell: (node: LensNode) => React.ReactElement;
  };
};

export function useSearchRenderers({
  t,
  results,
  activation,
  selectedId,
  onRevealInKb,
}: {
  t: GraphTranslator;
  results: SearchResultsState;
  activation: SearchActivation;
  selectedId?: string;
  onRevealInKb?: (nodeId: string) => void;
}): SearchRenderers {
  const {
    items: sortedItems,
    trimmed,
    isAdvanced,
    searchTree,
    hitById,
    metaByItem,
    attributesByItem,
    currentUserId,
  } = results;
  const { onSelectItem, activateItem } = activation;

  // The per-row "Open in KB" reveal affordance, on HIT rows only (a path folder is
  // structural). Omitted standalone (no `onRevealInKb`). `reveal:'hover'` for the grid
  // cards (corner overlay), `'always'` for the table action cell (no hover group).
  const revealAction = React.useCallback(
    (nodeId: string, reveal: 'hover' | 'always') =>
      onRevealInKb ? (
        <OpenInKbButton
          label={t('graph.panel.openInKb')}
          onOpen={() => onRevealInKb(nodeId)}
          reveal={reveal}
        />
      ) : undefined,
    [onRevealInKb, t]
  );

  // ONE search-result card — the Drive `ItemCard` (a `SearchResultItem` is a superset of
  // the projection item, ADR-0024 §1), with the snippet footer + the reveal action. Shared
  // by the flat grid AND every advanced grid leaf, so the two render modes never drift.
  const renderCard = React.useCallback(
    (item: SearchResultItem) => (
      <ItemCard
        key={item.id}
        t={t}
        node={{ id: item.id, kind: item.kind, title: item.title }}
        attributes={attributesByItem[item.id]}
        meta={metaByItem[item.id]}
        currentUserId={currentUserId}
        layout="grid"
        selected={item.id === selectedId}
        actions={revealAction(item.id, 'hover')}
        footer={
          item.snippet ? (
            <SearchSnippet
              snippet={item.snippet}
              term={trimmed}
              variant="block"
            />
          ) : null
        }
        onOpen={() => activateItem(item)}
        onDetails={() => onSelectItem(item)}
      />
    ),
    [
      t,
      attributesByItem,
      metaByItem,
      currentUserId,
      selectedId,
      trimmed,
      activateItem,
      onSelectItem,
      revealAction,
    ]
  );

  // Render a content LEAF of the advanced grid forest (look it up as a hit; a forest leaf
  // is always a content hit by construction). Reuses the SAME card as the flat grid.
  const renderTreeLeaf = React.useCallback(
    (node: LensNode) => {
      const item = hitById.get(node.id);
      return item ? renderCard(item) : null;
    },
    [hitById, renderCard]
  );

  // Build a `DriveRow` for the LIST table from a content hit — the row interaction +
  // actions match the cards (single → Details, double → open; reveal action on hover/always).
  const itemRow = React.useCallback(
    (item: SearchResultItem): DriveRow => ({
      id: item.id,
      node: { id: item.id, kind: item.kind, title: item.title },
      rowKind: 'item',
      onOpen: () => activateItem(item),
      onDetails: () => onSelectItem(item),
      actions: revealAction(item.id, 'always') ?? null,
    }),
    [activateItem, onSelectItem, revealAction]
  );

  // The flat list rows = the ranked hits (no ancestors); the advanced list rows = the
  // forest mapped to `DriveRow`s with `subRows` (the DataTable tree mode + `expansion:
  // 'always'` fully unfold it). A node's STRUCTURE follows its kind, not its hit status: a
  // FOLDER is a tree row carrying its in-set children as `subRows` (even when it is ITSELF
  // a matched hit — the chain stays visible); a non-folder LEAF is a hit content row. When
  // a folder is also a hit it carries the snippet + reveal action like any other hit; a
  // PURE path folder is inert (no open/details/actions). This mirrors the (deleted) forked
  // tree table, where `flattenTree` recursed every node's children and a hit folder row was
  // interactive — the grid renders a hit folder as a plain header instead (the same asymmetry).
  const listRows = React.useMemo<DriveRow[]>(() => {
    const toRow = (entry: SearchTreeNode): DriveRow => {
      if (entry.node.kind === 'folder') {
        const hit = entry.hit;
        return {
          id: entry.node.id,
          node: entry.node,
          rowKind: 'folder',
          onOpen: hit ? () => activateItem(hit) : () => {},
          onDetails: hit ? () => onSelectItem(hit) : () => {},
          actions: hit ? (revealAction(hit.id, 'always') ?? null) : null,
          subRows: entry.children.map(toRow),
        };
      }
      // A content leaf in the forest is always a matched hit by construction (the builder
      // only nests content that matched), so `entry.hit` is non-null here; a path-only node
      // is always a folder (handled above). Defensive fall-through renders an inert leaf row.
      return entry.hit
        ? itemRow(entry.hit)
        : {
            id: entry.node.id,
            node: entry.node,
            rowKind: 'item',
            onOpen: () => {},
            onDetails: () => {},
            actions: null,
          };
    };
    return isAdvanced ? searchTree.map(toRow) : sortedItems.map(itemRow);
  }, [
    isAdvanced,
    searchTree,
    sortedItems,
    itemRow,
    activateItem,
    onSelectItem,
    revealAction,
  ]);

  // The snippet column slot for the list table — looks the row's hit up and renders the
  // shared `snippetCell` (the matched excerpt, live term highlighted; em dash for a path
  // folder, which carries no hit). The SAME cell the (now-deleted) forked table rendered.
  const snippetSlot = React.useMemo(
    () => ({
      header: t('graph.table.snippet'),
      cell: (node: LensNode) => {
        const snippet = hitById.get(node.id)?.snippet;
        return snippet ? (
          <SearchSnippet snippet={snippet} term={trimmed} variant="inline" />
        ) : (
          <span className="text-muted-foreground/60">—</span>
        );
      },
    }),
    [t, hitById, trimmed]
  );

  return { renderCard, renderTreeLeaf, listRows, snippetSlot };
}
