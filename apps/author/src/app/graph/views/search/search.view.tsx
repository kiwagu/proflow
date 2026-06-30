'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import * as React from 'react';

import type { Containment } from '@/app/graph/containment';
import { DriveSidebar } from '@/app/graph/views/drive/drive-sidebar';
import type { DriveLayout } from '@/app/graph/views/drive/layout-toggle';
import type {
  DriveScope,
  KbViewData,
  LensView,
} from '@/app/graph/views/registry/projection-view.types';

import { SearchResults } from './search-results';
import { type SearchSelection } from './search-selection';
import { SearchToolbar } from './search-toolbar';
import { useSearchActivation } from './use-search-activation';
import { useSearchRenderers } from './use-search-renderers';
import { useSearchResults } from './use-search-results';

// Re-exported at the original module path so the workbench's selection wiring keeps
// importing it from `../views/search/search.view` (public-surface stability).
export type { SearchSelection } from './search-selection';

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
 * The component is a thin COMPOSITION: `useSearchResults` derives the render data (term,
 * layout cookie, the lexical fetch, the advanced forest), `useSearchActivation` owns the
 * hit→panel/navigate/read dispatch, `useSearchRenderers` builds the shared card/row/cell
 * leaves, and `SearchToolbar` / `SearchResults` render them in the shared `WorkbenchShell`
 * frame. Search is NOT a projection over the resolved canvas: it is the first consumer of
 * the standalone SEARCH capability (a SIBLING of projection-resolve), resolving its own
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

  const results = useSearchResults({
    spaceId,
    initialTerm,
    initialLayout,
    kbData,
    containment,
    lensView,
    onTermChange,
  });

  const activation = useSearchActivation({
    onSelect,
    onOpenFolder,
    onOpenDocument,
  });

  const renderers = useSearchRenderers({
    t,
    results,
    activation,
    selectedId,
    onRevealInKb,
  });

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
      toolbar={
        <SearchToolbar
          t={t}
          term={results.term}
          onInput={results.onInput}
          layout={results.layout}
          onLayoutChange={results.applyLayout}
          lensView={lensView}
          onLensViewChange={onLensViewChange}
          advancedStructuralEntitled={results.advancedStructuralEntitled}
        />
      }
      main={
        <SearchResults
          t={t}
          results={results}
          renderers={renderers}
          selectedId={selectedId}
          onRevealInKb={onRevealInKb}
        />
      }
    />
  );
}
