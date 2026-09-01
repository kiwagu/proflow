'use client';

import {
  PointerSensor,
  pointerWithin,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type PointerEvent,
  type MutableRefObject,
} from 'react';

/**
 * The drive's drag-and-drop contract: the sensor, the collision rule, the pane
 * namespace, and the live-drag state every droppable reads. The workbench owns
 * the one `DndContext`; the views only mark rows draggable and folders
 * droppable.
 *
 * Nothing here touches the store — a drop resolves to an intent, and the
 * intent is executed by the mutation hooks against the local ports.
 */

/**
 * Is the pointer-down target an interactive control, or inside a portaled
 * overlay (dialog / menu / select) — either of which must NOT begin a drag?
 *
 * Two reasons a press here must not drag:
 *  - Pressing a row's menu, star, link or input would start a micro-drag whose
 *    pointer-up is swallowed when the menu opens, leaving a STUCK drag (the
 *    body keeps `user-select: none`) that blocks selection everywhere.
 *  - A dialog opened FROM a card is a React child of that card's draggable, so
 *    even though it is DOM-portaled to the body its pointer events bubble up
 *    the REACT tree to the card's activator. Matching the overlay roles
 *    catches that without needing the card in the DOM chain.
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
 * A pointer sensor that only begins a drag from the non-interactive parts of a
 * row — so menus, stars, links and inputs keep their normal click behaviour
 * while a drag still starts anywhere else.
 */
export class DrivePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: PointerEvent): boolean =>
        !fromInteractive(event.target),
    },
  ];
}

/** A draggable node — carries what the overlay and the drop need, no lookup. */
export type DriveDragData = {
  type: 'node';
  nodeId: string;
  title: string;
  kind: string;
};

/** A drop target — a folder, or the "top level" affordance. */
export type DriveDropData =
  { type: 'folder'; folderId: string } | { type: 'root' };

/** The drop intent: move (default) or copy (modifier held). */
export type DriveDropIntent = 'move' | 'copy';

/**
 * The PANE a draggable/droppable belongs to. dnd-kit registers every element
 * under a unique id, but a split view renders the SAME nodes in both panes, so
 * a flat `node-${id}` collides: the second registration overwrites the first,
 * which mis-resolves the active element and makes one pane undraggable.
 * Namespacing the registration id by pane fixes that while the drop DATA stays
 * absolute (the real node/folder id), so cross-pane drops still work.
 */
const PaneContext = createContext<string>('main');

export const DrivePaneProvider = PaneContext.Provider;

/** The current pane's id — the prefix that makes a node's dnd ids unique. */
export function usePaneId(): string {
  return useContext(PaneContext);
}

/**
 * Among the droppables under the pointer, prefer a FOLDER over the (nested,
 * larger) root zone. The whole canvas is a root drop target so empty space
 * re-parents to the top level — but a folder sitting inside that canvas must
 * still win when the pointer is over it.
 *
 * Separated from the collision detection itself so the preference can be
 * exercised without dnd-kit's geometry: the ranking is this package's rule,
 * the hit test is dnd-kit's.
 */
export function preferFolderTarget<
  T extends {
    data?: { droppableContainer?: { data?: { current?: unknown } } };
  },
>(hits: T[]): T[] {
  const typeOf = (candidate: T): DriveDropData['type'] | undefined =>
    (
      candidate.data?.droppableContainer?.data?.current as
        DriveDropData | undefined
    )?.type;
  const folder = hits.find((candidate) => typeOf(candidate) === 'folder');
  if (folder) {
    return [folder];
  }
  const root = hits.find((candidate) => typeOf(candidate) === 'root');
  return root ? [root] : hits;
}

/** The drive's collision rule: dnd-kit's pointer hit test, ranked by ours. */
export const driveCollision: CollisionDetection = (args) =>
  preferFolderTarget(pointerWithin(args));

/**
 * The live drag, shared with every droppable so it can show a landing
 * affordance the moment a drag starts (not only on hover). `isInvalidTarget`
 * hides it on folders that cannot receive the active node — itself or a
 * descendant. Null = no drag in progress.
 */
export type DriveDragState = {
  activeId: string;
  isInvalidTarget: (folderId: string) => boolean;
};

const DragStateContext = createContext<DriveDragState | null>(null);

export const DriveDragProvider = DragStateContext.Provider;

/** The live drag (or null) — droppables read it to light up landing zones. */
export function useDriveDragState(): DriveDragState | null {
  return useContext(DragStateContext);
}

/**
 * Whether the copy modifier is held. dnd-kit's events do not surface modifier
 * keys on drop, so it is tracked globally for the duration of a drag. Alt is
 * the platform-conventional COPY modifier (Ctrl means "link" on macOS and is
 * commonly bound by the browser during pointer drags).
 */
export function useCopyModifier(): MutableRefObject<boolean> {
  const held = useRef(false);
  useEffect(() => {
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
