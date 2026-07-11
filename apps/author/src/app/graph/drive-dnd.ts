'use client';

import {
  PointerSensor,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
import * as React from 'react';

/**
 * Is the pointer-down target an interactive control, or inside a portaled overlay
 * (dialog / menu / select) — either of which must NOT begin a card drag?
 *
 * Two reasons a press here must not drag:
 *  - Pressing the card/row's ⋯ menu, star, a link, or an input would start a
 *    micro-drag whose pointer-up is swallowed when the menu/dialog opens, leaving a
 *    STUCK drag (dnd-kit keeps `user-select:none` on the body) that blocks text
 *    selection everywhere.
 *  - A dialog/menu/select opened FROM a card is a React child of that card's
 *    draggable, so even though Radix DOM-portals it to <body>, its pointer events
 *    bubble up the REACT tree to the card's `onPointerDown` activator. Selecting
 *    text in the Share dialog would otherwise start a drag of the card behind it.
 *    The DOM walk from a portaled overlay reaches its `role="dialog"|"menu"|
 *    "listbox"` container (and stops at <body>, never the card), so matching those
 *    roles catches the portal case without needing the card in the DOM chain.
 */
function fromInteractive(target: EventTarget | null): boolean {
  let node = target as HTMLElement | null;
  while (node) {
    const tag = node.tagName;
    const role = node.getAttribute?.('role');
    if (
      tag === 'BUTTON' ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'A' ||
      tag === 'LABEL' ||
      role === 'menuitem' ||
      role === 'dialog' ||
      role === 'alertdialog' ||
      role === 'menu' ||
      role === 'listbox' ||
      node.isContentEditable
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * PointerSensor that only begins a drag from NON-interactive parts of a card/row — so
 * the ⋯ menu, star toggle, links, and inputs keep their normal click/selection
 * behaviour while a drag still starts anywhere else (the 6px distance is set by the
 * caller's activation constraint).
 */
export class DrivePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: React.PointerEvent): boolean =>
        !fromInteractive(event.target),
    },
  ];
}

/**
 * Drive drag-and-drop wiring — the typed contract shared by the workbench (which
 * owns the ONE `DndContext` spanning both split panes, the move/copy mutation, and
 * the `DragOverlay`) and the view (which marks rows/cards as draggable nodes and
 * folders/the breadcrumb root as droppable targets).
 *
 * Cross-pane drops work because the drop DATA is ABSOLUTE — a `folder` target carries
 * the real graph `folderId`, so the workbench re-parents into it no matter which pane
 * it lives in. But the registration IDS must be unique PER PANE (the split renders the
 * same nodes twice): see {@link usePaneId}.
 */

/** A draggable node — a content/folder row or card. Carries what the overlay and the
 * mutation need without a lookup. */
export type DriveDragData = {
  type: 'node';
  nodeId: string;
  title: string;
  /** A folder can be dropped onto another folder, but never onto itself / a
   * descendant; the workbench guards self/no-op. Kind lets the view style the
   * overlay (folder vs file icon) and lets a folder refuse to drop into itself. */
  kind: string;
};

/** A drop target — a folder node, or the breadcrumb "top level" affordance. */
export type DriveDropData =
  { type: 'folder'; folderId: string } | { type: 'root' };

/** The DROP intent the workbench acts on: move (default) or copy (modifier held). */
export type DriveDropIntent = 'move' | 'copy';

/**
 * The PANE a draggable/droppable belongs to. dnd-kit registers every draggable and
 * droppable under a UNIQUE id — but the split renders the SAME nodes in BOTH panes,
 * so a flat `node-${id}` collides: the second registration overwrites the first, which
 * mis-resolves the active element (the overlay snaps to the wrong pane) and makes the
 * second pane un-draggable. The fix: namespace every registration id by pane. The drop
 * DATA stays ABSOLUTE (the real `nodeId`/`folderId`), so the workbench's move/copy is
 * pane-agnostic and cross-pane drops still work. The provider is hoisted to the
 * workbench (around each pane); leaf draggables/droppables read it for their id prefix.
 */
const PaneContext = React.createContext<string>('main');

export const DrivePaneProvider = PaneContext.Provider;

/** The current pane's id — the prefix that makes a node's dnd ids unique per pane. */
export function usePaneId(): string {
  return React.useContext(PaneContext);
}

/**
 * Collision: prefer a FOLDER target over the (nested, larger) root zone. The whole
 * canvas is a root drop target so the EMPTY space below the items re-parents to the
 * top level — but a folder sitting inside that canvas must still win when the pointer
 * is over it. So among the pointer's hits: a folder beats the root; only truly-empty
 * canvas (or the breadcrumb) resolves to root.
 */
export const driveCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const typeOf = (
    c: (typeof hits)[number]
  ): DriveDropData['type'] | undefined => {
    const container = c.data?.droppableContainer as
      { data?: { current?: DriveDropData } } | undefined;
    return container?.data?.current?.type;
  };
  const folder = hits.find((c) => typeOf(c) === 'folder');
  if (folder) {
    return [folder];
  }
  const root = hits.find((c) => typeOf(c) === 'root');
  return root ? [root] : hits;
};

/**
 * The live drag, shared with every droppable so it can show a "you can drop here"
 * affordance the moment a drag starts (not only on hover). `isInvalidTarget` hides
 * the affordance on folders that can't receive the active node — itself or any of its
 * descendants (re-parenting there would orphan a cycle; the workbench guards the drop,
 * this just keeps the HIGHLIGHT honest). Null = no drag in progress.
 */
export type DriveDragState = {
  activeId: string;
  isInvalidTarget: (folderId: string) => boolean;
};

const DragStateContext = React.createContext<DriveDragState | null>(null);

export const DriveDragProvider = DragStateContext.Provider;

/** The live drag (or null) — droppables read it to light up valid landing zones. */
export function useDriveDragState(): DriveDragState | null {
  return React.useContext(DragStateContext);
}

/**
 * Whether the copy modifier is held. dnd-kit's pointer/keyboard events do not surface
 * modifier keys on drop, so we track them globally for the duration of a drag. We use
 * the platform-conventional COPY modifier: Alt/Option (Ctrl is "link" on macOS and is
 * commonly bound by the browser/OS during pointer drags) — matching Finder/Dolphin,
 * where holding the modifier turns a move into a copy.
 */
export function useCopyModifier(): React.MutableRefObject<boolean> {
  const held = React.useRef(false);
  React.useEffect(() => {
    const sync = (event: KeyboardEvent | MouseEvent) => {
      held.current = event.altKey;
    };
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('pointerdown', sync);
    window.addEventListener('pointermove', sync);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('pointerdown', sync);
      window.removeEventListener('pointermove', sync);
    };
  }, []);
  return held;
}
