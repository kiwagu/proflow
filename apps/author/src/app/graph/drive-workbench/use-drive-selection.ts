'use client';

import type { ProjectionResult } from '@workspace/knowledge-contracts';
import * as React from 'react';

import type { SearchSelection } from '../views/search/search.view';
import type { SelectedNode } from '../views/resource-panel/resource-panel';

/**
 * Selection / active node for the Drive workbench — the transient Details drawer (NOT a
 * URL location). Owns the selected id, the search-hit fallback meta, the deliberate-open
 * signal, and the derived `selectedNode` / `openDoc` the panel + reader read.
 *
 * `recordOpen` records a DELIBERATE open of a node — viewing it in Details, opening it in
 * the reader, or navigating INTO a folder (ADR-0016 §3.3). Fire-and-forget under the
 * user's RLS via the opened route (gated by `space.knowledge.open`); a failure NEVER
 * blocks the UI (best-effort, an RLS rejection is a clean no-op). The DB roll-up advances
 * `resource_user_state.last_opened_at` from the appended row. We do NOT re-resolve on an
 * open — the per-user signal is read on the next refresh, not eagerly (no re-render storm
 * on every click; only real opens).
 */
export function useDriveSelection({
  spaceId,
  result,
}: {
  spaceId: string | undefined;
  result: ProjectionResult;
}) {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    undefined
  );
  // The renderable meta of a SEARCH hit opened from the search lens (ADR-0024 §5
  // follow-up). The Details panel derives `selectedNode` + its meta from the resolved
  // canvas (`result.items` / `kbData`), keyed by the resolved set — but a search hit can
  // be OUTSIDE that set (it resolves its own live result, a superset of the canvas). For
  // such a hit the canvas lookups return null, so the panel would either not open or show
  // a bare line. We stash the row's own fields here (the search result carries
  // kind/title/status/visibility) and read them as a FALLBACK below — no parallel data
  // path, no service-role, no widening: it is the SAME row RLS already admitted to the
  // result, surfaced to the SAME panel. (Description/grantees aren't on the search row;
  // those panel sections degrade gracefully — the on-demand description fetch is the
  // panel's existing RLS-fenced save route, never a new read path.)
  const [searchSelection, setSearchSelection] =
    React.useState<SearchSelection | null>(null);

  const recordOpen = React.useCallback(
    (nodeId: string) => {
      if (!spaceId) {
        return;
      }
      void fetch('/author/graph/opened', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, nodeId }),
      });
    },
    [spaceId]
  );

  const clearSelection = React.useCallback(() => setSelectedId(undefined), []);

  // Single-click a node → open the shared Details panel (a deliberate open).
  const selectNode = React.useCallback(
    (id: string) => {
      setSelectedId(id);
      recordOpen(id);
    },
    [recordOpen]
  );

  // Open the Details panel for a search hit, remembering its meta as the canvas fallback.
  const selectSearchHit = React.useCallback(
    (selection: SearchSelection) => {
      setSearchSelection(selection);
      setSelectedId(selection.id);
      recordOpen(selection.id);
    },
    [recordOpen]
  );

  // The canvas-keyed fallback for a search hit OUTSIDE the resolved canvas (ADR-0024 §5).
  // Only honoured when its id matches the live selection (a stale stash from a previous
  // search row is ignored — a canvas node always wins).
  const fallbackSelection =
    searchSelection && searchSelection.id === selectedId
      ? searchSelection
      : null;

  const selectedNode = React.useMemo<SelectedNode | null>(() => {
    if (!selectedId) {
      return null;
    }
    const item = result.items.find((entry) => entry.id === selectedId);
    if (item) {
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        status: item.status,
      };
    }
    // Out-of-canvas search hit — render the panel from the row's own carried meta so it
    // opens with correct kind/title/status (its description/versions/grantees sections
    // degrade gracefully; the description's own edit/save route stays RLS-fenced).
    return fallbackSelection
      ? {
          id: fallbackSelection.id,
          kind: fallbackSelection.kind,
          title: fallbackSelection.title,
          status: fallbackSelection.status,
        }
      : null;
  }, [selectedId, result.items, fallbackSelection]);

  return {
    selectedId,
    setSelectedId,
    clearSelection,
    recordOpen,
    selectNode,
    selectSearchHit,
    fallbackSelection,
    selectedNode,
  };
}
