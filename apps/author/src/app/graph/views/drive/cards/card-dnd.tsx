'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useMergedRef } from '@workspace/ui/hooks/use-merged-ref';
import { cn } from '@workspace/ui/lib/utils';
import * as React from 'react';

import { usePaneId, useDriveDragState } from '@/app/graph/drive-dnd';
import type { DriveDragData, DriveDropData } from '@/app/graph/drive-dnd';
import { FolderCard } from '@/app/graph/views/drive/cards/folder-card';
import { ItemCard } from '@/app/graph/views/drive/cards/item-card';

// ── drag & drop card wrappers ─────────────────────────────────────────────
// `useDraggable`/`useDroppable` are hooks, so they can't run inside a `.map()`;
// these one-per-card wrapper components call them and hand the wiring to the card.
// The workbench owns the DndContext + the move/copy mutation; these only mark a card
// as a drag source / drop target. A stable drag id lets the overlay/collision work.

/** A content card (file/doc/video) — a drag SOURCE only (not a drop target). */
export function DraggableItemCard(
  props: React.ComponentProps<typeof ItemCard> & { dragData: DriveDragData }
) {
  const { dragData, ...rest } = props;
  const paneId = usePaneId();
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${paneId}:node-${dragData.nodeId}`,
    data: dragData,
  });
  return (
    <ItemCard
      {...rest}
      dnd={{
        setRef: setNodeRef,
        listeners: listeners as Record<string, unknown> | undefined,
        attributes: attributes as unknown as Record<string, unknown>,
        dragging: isDragging,
      }}
    />
  );
}

/** A folder card — a drag SOURCE and a drop TARGET (other nodes re-parent into it). */
export function DraggableDroppableFolderCard(
  props: React.ComponentProps<typeof FolderCard> & { dragData: DriveDragData }
) {
  const { dragData, ...rest } = props;
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  const drag = useDraggable({
    id: `${paneId}:node-${dragData.nodeId}`,
    data: dragData,
  });
  const drop = useDroppable({
    id: `${paneId}:folder-${dragData.nodeId}`,
    data: { type: 'folder', folderId: dragData.nodeId } satisfies DriveDropData,
  });
  const setRef = useMergedRef(drag.setNodeRef, drop.setNodeRef);
  // Don't highlight a folder being dragged onto itself (compare the active drag's
  // node id, not the DOM element — the ids carry different prefixes).
  const activeNodeId = (drop.active?.data.current as DriveDragData | undefined)
    ?.nodeId;
  const dropOver = drop.isOver && activeNodeId !== dragData.nodeId;
  // A valid landing zone for the live drag (any folder except this drag's source /
  // its own subtree) — lit up the moment the drag starts.
  const candidate =
    !!dragState &&
    !dragState.isInvalidTarget(dragData.nodeId) &&
    !drag.isDragging;
  return (
    <FolderCard
      {...rest}
      dnd={{
        setRef,
        listeners: drag.listeners as Record<string, unknown> | undefined,
        attributes: drag.attributes as unknown as Record<string, unknown>,
        dragging: drag.isDragging,
        dropOver: dropOver && !drag.isDragging,
        candidate,
      }}
    />
  );
}

/** The breadcrumb "top level" drop zone — dropping here re-parents to the root. */
export function RootDropZone({
  children,
}: {
  children: (over: boolean) => React.ReactNode;
}) {
  const paneId = usePaneId();
  const { setNodeRef, isOver } = useDroppable({
    id: `${paneId}:drop-root-crumb`,
    data: { type: 'root' } satisfies DriveDropData,
  });
  return <span ref={setNodeRef}>{children(isOver)}</span>;
}

/**
 * The CANVAS drop zone — wraps the whole content area so a drop on the EMPTY space
 * below the items (not on a folder) re-parents into the folder THIS PANE is currently
 * viewing (the Dolphin/Finder model: dropping in the open folder lands in it; the
 * breadcrumb is for going up). At the root that means the top level — so this also
 * serves the "drop on empty space → root" case. Fills the pane height (`min-h-full`)
 * so the empty area is catchable; lights up dashed while a drag is active and solid on
 * hover. The custom `driveCollision` keeps folders winning when the pointer is on them.
 */
export function CanvasRootDropZone({
  folderId,
  children,
}: {
  folderId: string | null;
  children: React.ReactNode;
}) {
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  // Dropping into the folder we're viewing is invalid only when THAT folder is the
  // active node itself or its descendant (can't re-parent into your own subtree).
  const invalid =
    !!folderId && !!dragState && dragState.isInvalidTarget(folderId);
  const { setNodeRef, isOver } = useDroppable({
    id: `${paneId}:drop-canvas`,
    disabled: invalid,
    data: (folderId
      ? { type: 'folder', folderId }
      : { type: 'root' }) satisfies DriveDropData,
  });
  const active = !!dragState && !invalid;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-full rounded-lg',
        active &&
          'outline-ring/30 outline-1 -outline-offset-2 transition-colors outline-dashed',
        isOver && 'bg-accent/40 outline-ring/70'
      )}
    >
      {children}
    </div>
  );
}
