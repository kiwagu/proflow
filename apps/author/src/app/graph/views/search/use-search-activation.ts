'use client';

import { type SearchResultItem } from '@workspace/knowledge-contracts';
import * as React from 'react';

import type { ResourceFloor } from '@/app/graph/graph-data.types';
import { activationForKind } from '@/app/graph/presentation';

import type { SearchSelection } from './search-selection';

/**
 * The hit-activation callbacks the search lens hands its render leaves: opening the shared
 * ResourcePanel for a hit (carrying its renderable meta up for an out-of-canvas hit), and
 * the kind-dispatched primary activation (the SAME `activationForKind` map the command
 * palette uses — a container navigates IN, a document opens the reader, everything else
 * opens the Details panel). Lifted off the view so it is shared identically by the card,
 * the tree leaf, and the table row builders. Behaviour-preserving.
 */
export type SearchActivation = {
  /** Open the shared ResourcePanel for a hit (carries the row's renderable meta up). */
  onSelectItem: (item: SearchResultItem) => void;
  /** Primary activation, dispatched by the hit's kind (navigate / read / details). */
  activateItem: (item: SearchResultItem) => void;
};

export function useSearchActivation({
  onSelect,
  onOpenFolder,
  onOpenDocument,
}: {
  onSelect: (selection: SearchSelection) => void;
  onOpenFolder?: (nodeId: string) => void;
  onOpenDocument?: (nodeId: string) => void;
}): SearchActivation {
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

  return { onSelectItem, activateItem };
}
