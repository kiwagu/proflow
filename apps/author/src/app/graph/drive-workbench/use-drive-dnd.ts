'use client';

import {
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import * as React from 'react';

import {
  DrivePointerSensor,
  useCopyModifier,
  type DriveDragData,
  type DriveDragState,
  type DriveDropData,
} from '../drive-dnd';
import type { Containment } from '../containment';

/**
 * Workbench-level drag & drop orchestration (move = re-parent; Alt-held = copy). It
 * CONSUMES the typed contract + sensor + collision + copy-modifier helpers from
 * `drive-dnd.ts`; this hook owns the live drag state, the self/descendant guard, and the
 * move/copy mutation the ONE `DndContext` (declared in the workbench JSX) drives.
 *
 * Copy-vs-move: the modifier-held (`copyHeld`) drop is a deep COPY; the default is a MOVE
 * (re-parent). `isSelfOrDescendant` prevents dropping a folder into its own subtree (which
 * would orphan a cycle). A success re-resolves via `refresh`.
 */
export function useDriveDnd({
  spaceId,
  containment,
  refresh,
  copySuffix,
}: {
  spaceId: string | undefined;
  containment: Containment;
  refresh: () => void;
  /** Builds the "(copy)" title for a same-folder copy — the workbench owns `t`. */
  copySuffix: (title: string) => string;
}) {
  const dndSensors = useSensors(
    // A small activation distance so a click still selects/opens a row (the
    // single/double-click split is preserved) — only a real drag past 6px starts DnD.
    useSensor(DrivePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const copyHeld = useCopyModifier();
  const [dragData, setDragData] = React.useState<DriveDragData | null>(null);
  // The live drag, shared with every droppable so valid landing zones light up the
  // moment a drag starts (folders + the root). Null between drags.
  const [dragState, setDragState] = React.useState<DriveDragState | null>(null);

  // Is `folderId` the node itself or a descendant of `nodeId`? (a folder may not be
  // re-parented into its own subtree — that would orphan the cycle).
  const isSelfOrDescendant = React.useCallback(
    (nodeId: string, folderId: string): boolean => {
      if (nodeId === folderId) {
        return true;
      }
      let cursor: string | undefined = folderId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        if (cursor === nodeId) {
          return true;
        }
        seen.add(cursor);
        cursor = containment.parentOf.get(cursor);
      }
      return false;
    },
    [containment]
  );

  const onDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DriveDragData | undefined;
      setDragData(data ?? null);
      setDragState(
        data
          ? {
              activeId: data.nodeId,
              isInvalidTarget: (folderId) =>
                isSelfOrDescendant(data.nodeId, folderId),
            }
          : null
      );
    },
    [isSelfOrDescendant]
  );

  const endDrag = React.useCallback(() => {
    setDragData(null);
    setDragState(null);
  }, []);

  const onDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const active = event.active.data.current as DriveDragData | undefined;
      const over = event.over?.data.current as DriveDropData | undefined;
      endDrag();
      if (!active || !over || !spaceId) {
        return;
      }
      const targetFolderId = over.type === 'folder' ? over.folderId : null;
      const currentParent = containment.parentOf.get(active.nodeId) ?? null;
      const copy = copyHeld.current;

      // Move guards: a no-op drop (already in this folder, or onto itself) and the
      // self/descendant cycle. Copy has no such restriction — a copy into the same
      // folder is a legitimate duplicate.
      if (!copy) {
        if (targetFolderId === currentParent) {
          return; // already here (root→root or same folder) — nothing to do.
        }
        if (
          targetFolderId &&
          isSelfOrDescendant(active.nodeId, targetFolderId)
        ) {
          return; // can't move a folder into its own subtree.
        }
      } else if (
        targetFolderId &&
        isSelfOrDescendant(active.nodeId, targetFolderId)
      ) {
        return; // copying a folder into its own subtree would recurse — skip.
      }

      if (copy) {
        // Copying into the SAME folder is a duplicate — suffix "(copy)" so it is not a
        // same-named sibling. A copy to a DIFFERENT folder keeps the name (no clash),
        // matching Finder/Dolphin.
        const rootTitle =
          targetFolderId === currentParent
            ? copySuffix(active.title)
            : undefined;
        void fetch('/author/graph/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spaceId,
            sourceId: active.nodeId,
            targetFolderId,
            ...(rootTitle ? { rootTitle } : {}),
          }),
        }).then((res) => {
          if (res.ok) {
            refresh();
          }
        });
        return;
      }

      // Move = re-parent: drop the current contains edge, then (unless top level)
      // add a contains edge from the target folder — the same dance the ⋯ Move uses.
      void (async () => {
        let ok = true;
        if (currentParent) {
          const res = await fetch('/author/graph/edges', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spaceId,
              fromId: currentParent,
              toId: active.nodeId,
              relationType: 'contains',
            }),
          });
          ok = res.ok;
        }
        if (ok && targetFolderId) {
          const res = await fetch('/author/graph/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'contain',
              spaceId,
              folderId: targetFolderId,
              childId: active.nodeId,
            }),
          });
          ok = res.ok;
        }
        if (ok) {
          refresh();
        }
      })();
    },
    [
      spaceId,
      containment,
      copyHeld,
      isSelfOrDescendant,
      refresh,
      endDrag,
      copySuffix,
    ]
  );

  return { dndSensors, dragData, dragState, onDragStart, onDragEnd, endDrag };
}
