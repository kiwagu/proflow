'use client';

import {
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useState } from 'react';
import type { Containment } from './containment.js';
import { isSelfOrDescendant } from './containment.js';
import {
  DrivePointerSensor,
  useCopyModifier,
  type DriveDragData,
  type DriveDragState,
  type DriveDropData,
} from './drive-dnd.js';
import type { DriveMutations } from './use-drive-mutations.js';

/**
 * Drag-and-drop orchestration for the drive: move on drop, copy when the
 * modifier is held. It owns the live drag state and the guards; the actual
 * write goes through the local mutations, so a drop is applied to the replica
 * and the canvas re-renders off the live query — no refresh, and it works with
 * the network down.
 */
export function useDriveDnd({
  containment,
  mutations,
  copySuffix,
}: {
  containment: Containment;
  mutations: DriveMutations;
  /** Builds the "(copy)" title for a same-folder copy — the host owns wording. */
  copySuffix: (title: string) => string;
}) {
  const dndSensors = useSensors(
    // A small activation distance so a click still selects/opens a row — only
    // a real drag past 6px starts DnD.
    useSensor(DrivePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const copyHeld = useCopyModifier();
  const [dragData, setDragData] = useState<DriveDragData | null>(null);
  const [dragState, setDragState] = useState<DriveDragState | null>(null);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DriveDragData | undefined;
      setDragData(data ?? null);
      setDragState(
        data
          ? {
              activeId: data.nodeId,
              isInvalidTarget: (folderId) =>
                isSelfOrDescendant(containment, data.nodeId, folderId),
            }
          : null
      );
    },
    [containment]
  );

  const endDrag = useCallback(() => {
    setDragData(null);
    setDragState(null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = event.active.data.current as DriveDragData | undefined;
      const over = event.over?.data.current as DriveDropData | undefined;
      endDrag();
      if (!active || !over) {
        return;
      }
      const target = over.type === 'folder' ? over.folderId : null;
      const currentParent = containment.parentOf.get(active.nodeId) ?? null;

      if (copyHeld.current) {
        // Copying into the SAME folder is a duplicate, so it gets the "(copy)"
        // suffix rather than becoming a same-named sibling. A copy elsewhere
        // keeps its name (no clash), matching desktop file managers.
        const rootTitle =
          target === currentParent ? copySuffix(active.title) : undefined;
        void mutations.copyNode(active.nodeId, target, rootTitle);
        return;
      }
      // The move guards live in the mutation (a no-op target and the cycle),
      // so a drop and a menu-driven move cannot diverge.
      void mutations.moveNode(active.nodeId, target);
    },
    [containment, copyHeld, copySuffix, endDrag, mutations]
  );

  return { dndSensors, dragData, dragState, onDragStart, onDragEnd, endDrag };
}
