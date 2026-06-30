'use client';

import type { ProjectionResult } from '@workspace/knowledge-contracts';
import * as React from 'react';

import { buildContainment } from '../containment';
import type { ResourceFloor, SharedByMeEntry } from '../graph-data.types';
import type {
  KbViewData,
  LensView,
} from '../views/registry/projection-view.types';

/**
 * Canvas derivations for the Drive workbench — the memoised maps the panel + DnD read off
 * the resolved canvas, plus the "Open in KB" reveal (and its deferred restore-from-trash
 * variant).
 *
 *  - `containment` over the resolved canvas — fed to the panel (Move folder picker) AND
 *    the drag-and-drop guard (a folder can't drop into itself / a descendant).
 *  - `sharedByMeGranteesById` / `sharedByMeIds` / `visibilityById` — the access-mirror
 *    inputs the ResourcePanel's Access summary walks (ADR-0023 §7b). SAME source as the
 *    Drive card badges, so summary and badge can never diverge.
 *  - `revealInKb` — the panel's "Open in KB" action, forcing the default 'kb' lens at the
 *    node's PARENT folder so the resource shows among its siblings.
 *
 * The pending-reveal ref + effect implement the DEFERRED reveal for restore-from-trash: a
 * restored node's `contains` edge is only active AFTER the re-resolve, so `restoreNode`
 * sets `revealAfterRefresh(nodeId)` + refreshes and we wait for the first `containment`
 * change (the new data landing), then jump to its KB position.
 */
export function useDriveCanvasDerivations({
  result,
  kbData,
  lensView,
  setFolderId,
  setDocId,
  setScope,
  setSelectedId,
  setSplit,
  pushLocation,
  recordOpen,
}: {
  result: ProjectionResult;
  kbData: KbViewData | undefined;
  lensView: LensView;
  setFolderId: (id: string | null) => void;
  setDocId: (id: string | null) => void;
  setScope: (scope: 'kb') => void;
  setSelectedId: (id: string | undefined) => void;
  setSplit: (on: false) => void;
  pushLocation: (loc: {
    folder: string | null;
    doc: string | null;
    scope: 'kb';
    view: LensView;
  }) => void;
  recordOpen: (nodeId: string) => void;
}) {
  const containment = React.useMemo(
    () => buildContainment(result.items, kbData?.containment ?? []),
    [result.items, kbData]
  );

  // The "shared by me" overlay reshaped for the ResourcePanel's Access summary (ADR-0023
  // §7b): a per-resource grantee map (the node's explicit grantees) + the SET of ids the
  // owner shared OUT (the membership test for the access-mirror ancestor walk). SAME source
  // as the Drive card badge, so the panel summary and the badge can never diverge.
  const sharedByMeGranteesById = React.useMemo(() => {
    const map = new Map<string, SharedByMeEntry['grantees']>();
    for (const entry of kbData?.sharedByMe ?? []) {
      map.set(entry.resourceId, entry.grantees);
    }
    return map;
  }, [kbData]);
  const sharedByMeIds = React.useMemo(
    () => new Set(sharedByMeGranteesById.keys()),
    [sharedByMeGranteesById]
  );
  // The broadcast-floor lookup for the panel's access-mirror walk (ADR-0023 §7b): each
  // node's `visibility` floor from the already-loaded `metaByItem` (no new load). The
  // panel runs `broadcastOut` over it + the containment forest to name an INHERITED
  // broadcast ("Broadcast via folder {X}"), the exact mirror of the card globe badge.
  const visibilityById = React.useMemo(() => {
    const map = new Map<string, ResourceFloor>();
    for (const [id, meta] of Object.entries(kbData?.metaByItem ?? {})) {
      map.set(id, meta.visibility);
    }
    return map;
  }, [kbData]);

  // Reveal a node in the KB containment tree (the panel's "Open in KB" action). FORCES the
  // default 'kb' lens at the node's PARENT folder so the resource shows among its siblings
  // (its position in the tree), and keeps it selected so it is highlighted. Works from any
  // flat cross-cutting lens or the advanced tree, where the containment context is lost.
  const revealInKb = React.useCallback(
    (nodeId: string) => {
      const parent = containment.parentOf.get(nodeId) ?? null;
      setDocId(null);
      setSplit(false);
      setFolderId(parent);
      setScope('kb');
      setSelectedId(nodeId);
      pushLocation({ folder: parent, doc: null, scope: 'kb', view: lensView });
      if (parent) {
        recordOpen(parent);
      }
    },
    [
      containment,
      pushLocation,
      lensView,
      recordOpen,
      setDocId,
      setSplit,
      setFolderId,
      setScope,
      setSelectedId,
    ]
  );

  // A node id to reveal in the KB tree once the NEXT re-resolve lands (used by restore-from-
  // trash, whose `contains` edge only becomes active after the refresh). The effect below
  // fires on the first `containment` change after this is set. A ref so setting it never
  // re-renders and it survives the refresh.
  const pendingRevealRef = React.useRef<string | null>(null);
  const revealAfterRefresh = React.useCallback((nodeId: string) => {
    pendingRevealRef.current = nodeId;
  }, []);

  // Deferred reveal for restore-from-trash: a restored node's `contains` edge is only active
  // AFTER the re-resolve, so `restoreNode` sets `pendingRevealRef` + refreshes and we wait
  // for the first `containment` change (the new data landing), then jump to its KB position.
  React.useEffect(() => {
    if (!pendingRevealRef.current) {
      return;
    }
    const id = pendingRevealRef.current;
    pendingRevealRef.current = null;
    revealInKb(id);
  }, [containment, revealInKb]);

  return {
    containment,
    sharedByMeGranteesById,
    sharedByMeIds,
    visibilityById,
    revealInKb,
    revealAfterRefresh,
  };
}
