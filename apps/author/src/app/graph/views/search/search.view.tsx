'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { type SearchResultItem } from '@workspace/knowledge-contracts';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { Input } from '@workspace/ui/components/input';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { Search } from 'lucide-react';
import * as React from 'react';

import type { Containment, LensNode } from '@/app/graph/containment';
import type { NodeMeta, ResourceFloor } from '@/app/graph/graph-data.types';
import { activationForKind } from '@/app/graph/presentation';
import {
  ItemCard,
  LensListTable,
  type DriveRow,
} from '@/app/graph/views/drive/drive-projection.view';
import { DriveSidebar } from '@/app/graph/views/drive/drive-sidebar';
import {
  LayoutToggle,
  type DriveLayout,
} from '@/app/graph/views/drive/layout-toggle';
import {
  LensTreeGrid,
  type LensTreeNode,
} from '@/app/graph/views/drive/lens-tree-grid';
import { LensViewToggle } from '@/app/graph/views/drive/lens-view-toggle';
import type {
  DriveScope,
  KbViewData,
  LensView,
} from '@/app/graph/views/registry/projection-view.types';

import { OpenInKbButton } from './open-in-kb-button';
import { SearchSnippet } from './search-snippet';
import { buildSearchTree, type SearchTreeNode } from './search-tree';
import { useLexicalSearch } from './use-lexical-search';

/**
 * The renderable meta a SEARCH hit carries on the wire (ADR-0024 §1) — the subset of
 * `SearchResultItem` the SHARED ResourcePanel needs to render correct meta when the
 * hit is NOT in the resolved Drive canvas (`kbData`/`result.items`). The workbench
 * keeps these keyed by id and reads them as a FALLBACK so opening a search result
 * (`kind`/`status`/broadcast `visibility`) shows the node's real meta line instead of
 * a bare degraded one — and so the panel opens at all for an out-of-canvas hit (whose
 * `selectedNode` would otherwise resolve to null). `visibility` is the broadcast floor
 * the row already carries; never a fence (RLS already admitted the row to the result).
 */
export type SearchSelection = {
  id: string;
  kind: string;
  title: string;
  status: string;
  visibility: ResourceFloor;
};

/**
 * SearchView — the lexical-search lens (ADR-0024 §5), rendered as a CONFIG of the ONE
 * parameterizable lens (ADR-0025), NOT a forked renderer. It owns only the irreducible
 * search delta — the live RLS-fenced fetch (`useLexicalSearch`), the hits∪ancestors
 * node-set builder (`buildSearchTree`), and the snippet/highlight slot (`SearchSnippet`)
 * — and renders every result through the SAME leaves every other lens uses: the Drive
 * `ItemCard` (grid), the shared `LensListTable` (list, flat + the fully-expanded advanced
 * tree), and the `LensTreeGrid` (the advanced grid). There is no `search-result-table` /
 * `search-result-tree` / `search-row-cells` renderer — those were the fork ADR-0025 deletes.
 *
 * Search is NOT a projection over the resolved canvas: it is the first consumer of the
 * standalone SEARCH capability (a SIBLING of projection-resolve), resolving its own
 * `SearchResult` live as the user types. The browser POSTs only a `term` + `spaceId` to
 * `/author/graph/search`; the server compiles + runs the SELECT AS THE USER, so Postgres
 * RLS is the sole access fence (ADR-0024 §6).
 *
 * The two axes match every other lens: layout (grid tiles ↔ list table, the shared
 * `drive-layout` cookie) is ORTHOGONAL to the lens-view axis (flat ↔ advanced, the
 * Pro-gated `?view=`). Flat = the ranked matched LEAVES (cards or table); advanced = the
 * matched leaves placed in their FULLY-EXPANDED ancestor-folder TREE at UNBOUNDED depth
 * (nested folder sections + leaf cards in grid; one depth-indented force-expanded table in
 * list). Each result row carries the snippet excerpt + a per-row "Open in KB" reveal — the
 * ONLY things that differ from a KB/Shared row.
 */

const GRID_WRAP = 'flex flex-wrap gap-2.5';

export function SearchView({
  messages,
  spaceId,
  initialTerm,
  selectedId,
  onSelect,
  onOpenDocument,
  onOpenFolder,
  kbData,
  onTermChange,
  containment,
  onScopeChange,
  onNavigate,
  onMutated,
  onRevealInKb,
  lensView = 'flat',
  onLensViewChange,
  initialLayout,
}: {
  messages: Record<string, string>;
  spaceId?: string;
  /** The `?q=` term the workbench seeds from the URL (SSR-stable first render). */
  initialTerm: string;
  /** The currently selected node id (shared across views — highlights the row). */
  selectedId?: string;
  /**
   * Single-click a row → open the SHARED ResourcePanel (owned by the workbench). The
   * SELECTED search item's renderable meta rides along so the panel can render correct
   * meta even when the hit is NOT in the resolved canvas (`result.items`/`kbData`) —
   * the workbench reads it as a fallback (ADR-0024 §5, out-of-canvas hit follow-up).
   */
  onSelect: (selection: SearchSelection) => void;
  /** Open a `text` node in the reader (owned by the workbench). */
  onOpenDocument?: (nodeId: string) => void;
  /** Navigate INTO a `folder` hit (jump to it in the KB tree, owned by the workbench). */
  onOpenFolder?: (nodeId: string) => void;
  /** Server-loaded KB seed — read for the owner "You" label + node meta line. */
  kbData?: KbViewData;
  /** Mirror the live term back to the workbench (which writes `?q=` to the URL). */
  onTermChange?: (term: string) => void;
  /**
   * The containment forest over the resolved canvas (built once by the workbench) — the
   * SAME forest the Drive rail walks for its "Sections" roots, so the search lens's shared
   * sidebar shows the identical sections, and `buildSearchTree` nests hits in it for advanced.
   */
  containment: Containment;
  /** Switch the lens scope — wired so the shared rail's nav can leave 'search'. */
  onScopeChange: (scope: DriveScope) => void;
  /** Navigate to a folder (null → root) — the shared rail's "Sections" roots + the KB nav
   * item use it (leaving the search lens for the folder's KB location). */
  onNavigate: (folderId: string | null) => void;
  /** Re-resolve after a create from the shared rail's "New" launcher. */
  onMutated: () => void;
  /**
   * Reveal a HIT in the KB containment tree — jump to the 'kb' lens at the node's PARENT
   * folder, node highlighted (the workbench's `revealInKb`, the SAME action the Details
   * panel + the Drive `⋯` menu expose). Wired to the per-row "Open in KB" affordance on
   * every search result row. Optional — omitted standalone / in tests.
   */
  onRevealInKb?: (nodeId: string) => void;
  /**
   * The lens DISPLAY MODE (ADR-0022 + Addendum A), owned by the workbench in the URL
   * (`?view=`). The search lens carries the SAME Flat↔Advanced toggle as the structural
   * lenses (present + Pro-gated). Defaults 'flat'. Gated by the `advancedStructuralView`
   * entitlement.
   */
  lensView?: LensView;
  /** Switch the lens display mode (Flat ↔ Advanced). The workbench writes `?view=`. */
  onLensViewChange?: (view: LensView) => void;
  /**
   * The display LAYOUT (grid tiles ↔ list table), seeded from the SAME server-read
   * `drive-layout` cookie the Drive lenses use — so the chosen layout PERSISTS across
   * every lens. The toggle writes the cookie back. ORTHOGONAL to the lens-view axis.
   */
  initialLayout?: DriveLayout;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const [term, setTerm] = React.useState(initialTerm);
  // Grid/list layout — seeded from the server-read `drive-layout` cookie (SSR-stable, no
  // post-hydration flip) and written back by the toggle, exactly as the Drive lenses do.
  const [layout, setLayout] = React.useState<DriveLayout>(
    initialLayout ?? 'grid'
  );
  const applyLayout = React.useCallback((next: DriveLayout) => {
    setLayout(next);
    if (typeof document !== 'undefined') {
      document.cookie = `drive-layout=${next};path=/;max-age=31536000;samesite=lax`;
    }
  }, []);

  const currentUserId = kbData?.currentUserId ?? null;
  // Memoized so the `?? {}` default is a STABLE reference — fed to the row/cell builders,
  // and a fresh `{}` each render would invalidate their memos (react-hooks/exhaustive-deps).
  const metaByItem = React.useMemo(
    () => kbData?.metaByItem ?? {},
    [kbData]
  ) as Record<string, NodeMeta>;
  const attributesByItem = React.useMemo(
    () => kbData?.attributesByItem ?? {},
    [kbData]
  );
  // The COMMERCIAL entitlement (ADR-0022 Fork 1) — the Pro gate for the Flat↔Advanced
  // toggle. Resolved server-side from the platform registry, fail-CLOSED `false`. The
  // toggle shows either way (the locked control is the upsell); only its ENABLED state
  // depends on it.
  const advancedStructuralEntitled =
    kbData?.entitlements?.advancedStructuralView ?? false;

  // The ONE lexical-search fetch path (shared with the command palette) — debounced,
  // min-2-char, race-safe, RLS-fenced; returns the server-ordered rows for this term.
  const {
    items: sortedItems,
    loading,
    resolved,
    tooShort,
    trimmed,
  } = useLexicalSearch(spaceId, term);

  const onInput = React.useCallback(
    (next: string) => {
      setTerm(next);
      onTermChange?.(next);
    },
    [onTermChange]
  );

  // Open the shared ResourcePanel for a search hit, carrying the row's own renderable
  // meta up (so an out-of-canvas hit still shows correct kind/status/visibility).
  const onSelectItem = React.useCallback(
    (item: SearchResultItem) => {
      onSelect({
        id: item.id,
        kind: item.kind,
        title: item.title,
        status: item.status,
        visibility: item.visibility as ResourceFloor,
      });
    },
    [onSelect]
  );

  // Activating a row dispatches by the kind's ACTIVATION behaviour (presentation.ts) —
  // the SAME map the command palette uses: a container navigates IN, a document opens the
  // reader, everything else opens the shared Details panel.
  const activateItem = React.useCallback(
    (item: SearchResultItem) => {
      switch (activationForKind(item.kind)) {
        case 'navigate':
          onOpenFolder?.(item.id);
          return;
        case 'read':
          onOpenDocument?.(item.id);
          return;
        default:
          onSelectItem(item);
          return;
      }
    },
    [onOpenFolder, onOpenDocument, onSelectItem]
  );

  // The advanced (GROUPED) render is ON only when the lens mode is 'advanced' AND the
  // space is entitled (ADR-0022 — the same Pro gate the structural lenses use). The
  // server clamps `?view=` to 'flat' on a locked plan; this client clamp is belt-and-braces.
  const isAdvanced = lensView === 'advanced' && advancedStructuralEntitled;

  // The hits keyed by id — the snippet slot + activation map read the row off this so the
  // shared leaves (which carry only a `LensNode`) recover the full `SearchResultItem`.
  const hitById = React.useMemo(() => {
    const map = new Map<string, SearchResultItem>();
    for (const item of sortedItems) {
      map.set(item.id, item);
    }
    return map;
  }, [sortedItems]);

  // The matched leaves placed in their FULLY-EXPANDED ancestor-folder tree (the SAME
  // containment tree the KB / Shared advanced lens renders, specialized to search). The
  // node-set is hits ∪ ALL their ancestor folders (`buildSearchTree`); built only in advanced.
  const searchTree = React.useMemo(
    () => (isAdvanced ? buildSearchTree(sortedItems, containment) : []),
    [isAdvanced, sortedItems, containment]
  );

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
      />
    </div>
  );

  const toolbar = (
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
      <LayoutToggle t={t} layout={layout} onLayoutChange={applyLayout} />
    </div>
  );

  const main = (
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

  if (!spaceId) {
    return null;
  }

  // The shared Drive left-rail — the SAME chrome every other lens renders, so search sits
  // in the workbench frame (sidebar nav + toolbar + the shared Details panel the workbench
  // overlays on `onSelect`) exactly like Shared. The "Search" nav item highlights as active.
  const sidebar = (
    <DriveSidebar
      t={t}
      scope="search"
      onScopeChange={onScopeChange}
      onNavigate={onNavigate}
      folderId={null}
      containment={containment}
      spaceId={spaceId}
      onMutated={onMutated}
    />
  );

  return (
    <WorkbenchShell
      panel={{
        kind: 'fixed',
        width: 230,
        'aria-label': t('graph.drive.navSearch'),
        children: sidebar,
      }}
      toolbar={toolbar}
      main={main}
    />
  );
}

// A stable empty default-sorting reference — the search list keeps the server rank order
// (no column default sort), and a fresh literal each render would thrash the table's memo.
const SEARCH_LIST_NO_SORT: { id: string; desc: boolean }[] = [];
