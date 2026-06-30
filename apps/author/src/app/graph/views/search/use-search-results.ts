'use client';

import { type SearchResultItem } from '@workspace/knowledge-contracts';
import * as React from 'react';

import type { Containment } from '@/app/graph/containment';
import type { KbAttributes, NodeMeta } from '@/app/graph/graph-data.types';
import type { DriveLayout } from '@/app/graph/views/drive/layout-toggle';
import type {
  KbViewData,
  LensView,
} from '@/app/graph/views/registry/projection-view.types';

import { buildSearchTree, type SearchTreeNode } from './search-tree';
import {
  useLexicalSearch,
  type LexicalSearchState,
} from './use-lexical-search';

/**
 * The derived data the search lens renders from — the live RLS-fenced fetch
 * (`useLexicalSearch`) plus everything the view derives off it: the term input state, the
 * grid/list layout (the shared `drive-layout` cookie), the Pro-gated Flat↔Advanced clamp,
 * the hits-by-id lookup the shared leaves recover their row from, and the advanced
 * hits∪ancestors forest (`buildSearchTree`, built only in advanced). Lifting this off the
 * view leaves `SearchView` a thin composition and keeps the irreducible search delta in
 * one place. No behaviour change — the same triggers, timing, memo keys, and clamps the
 * view held inline.
 */
export type SearchResultsState = LexicalSearchState & {
  /** The live term the input element binds to (seeded from `?q=`). */
  term: string;
  /** Update the term + mirror it back to the workbench (which writes `?q=`). */
  onInput: (next: string) => void;
  /** The grid/list display layout (seeded from the `drive-layout` cookie). */
  layout: DriveLayout;
  /** Switch the layout + persist it to the `drive-layout` cookie. */
  applyLayout: (next: DriveLayout) => void;
  /** The owner-"You" label source (read from the KB seed). */
  currentUserId: string | null;
  /** Stable per-item meta map (defaulted to a stable `{}` so row builders' memos hold). */
  metaByItem: Record<string, NodeMeta>;
  /** Stable per-item attributes map (same stable-default reason). */
  attributesByItem: Record<string, KbAttributes>;
  /** The Pro entitlement that gates the Flat↔Advanced toggle (fail-closed `false`). */
  advancedStructuralEntitled: boolean;
  /** Advanced (grouped) render is ON — mode is 'advanced' AND the space is entitled. */
  isAdvanced: boolean;
  /** The hits keyed by id — the shared leaves (which carry only a `LensNode`) recover the
   * full `SearchResultItem` (snippet + activation) off this. */
  hitById: Map<string, SearchResultItem>;
  /** The matched leaves in their fully-expanded ancestor forest; `[]` unless advanced. */
  searchTree: SearchTreeNode[];
};

/**
 * Derive the search lens's render data from its inputs. Owns only state + memoization —
 * no JSX, no callbacks into the workbench (those stay on the view). Behaviour-preserving:
 * the memo dependencies, the `?? {}` stable defaults, the `isAdvanced` belt-and-braces
 * clamp, and the `buildSearchTree` gate are byte-identical to the inline original.
 */
export function useSearchResults({
  spaceId,
  initialTerm,
  initialLayout,
  kbData,
  containment,
  lensView,
  onTermChange,
}: {
  spaceId?: string;
  initialTerm: string;
  initialLayout?: DriveLayout;
  kbData?: KbViewData;
  containment: Containment;
  lensView: LensView;
  onTermChange?: (term: string) => void;
}): SearchResultsState {
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
  const search = useLexicalSearch(spaceId, term);
  const { items: sortedItems } = search;

  const onInput = React.useCallback(
    (next: string) => {
      setTerm(next);
      onTermChange?.(next);
    },
    [onTermChange]
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

  return {
    ...search,
    term,
    onInput,
    layout,
    applyLayout,
    currentUserId,
    metaByItem,
    attributesByItem,
    advancedStructuralEntitled,
    isAdvanced,
    hitById,
    searchTree,
  };
}
