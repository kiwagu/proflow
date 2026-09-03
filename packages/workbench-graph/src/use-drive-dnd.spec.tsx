import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  preferFolderTarget,
  type DriveDragData,
  type DriveDropData,
} from './drive-dnd.js';
import { GraphServicesProvider } from './graph-services.js';
import { closeTestGraph, openTestGraph, type TestGraph } from './testing.js';
import { useDriveData } from './use-drive-data.js';
import { useDriveDnd } from './use-drive-dnd.js';
import { useDriveMutations } from './use-drive-mutations.js';

/**
 * Drag and drop, driven through the same events dnd-kit delivers. The drop
 * handler is the seam worth testing directly: rendering a real drag would test
 * dnd-kit, whereas what this package owns is which intent a drop resolves to
 * and what that does to the local rows.
 */

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

const dragStart = (data: DriveDragData): DragStartEvent =>
  ({
    active: { id: data.nodeId, data: { current: data } },
  }) as unknown as DragStartEvent;

const dragEnd = (
  data: DriveDragData,
  over: DriveDropData | null
): DragEndEvent =>
  ({
    active: { id: data.nodeId, data: { current: data } },
    over: over ? { id: 'drop', data: { current: over } } : null,
  }) as unknown as DragEndEvent;

function mountDnd(open: TestGraph) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GraphServicesProvider services={open.services}>
      {children}
    </GraphServicesProvider>
  );
  return renderHook(
    () => {
      const data = useDriveData();
      const mutations = useDriveMutations(data.containment);
      return {
        data,
        dnd: useDriveDnd({
          containment: data.containment,
          mutations,
          copySuffix: (title) => `${title} (copy)`,
        }),
      };
    },
    { wrapper }
  );
}

describe('dropping a node on the drive', () => {
  it('re-parents it into the folder it was dropped on', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountDnd(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    const dragged: DriveDragData = {
      type: 'node',
      nodeId: doc,
      title: 'Doc',
      kind: 'text',
    };
    await act(async () => {
      view.result.current.dnd.onDragEnd(
        dragEnd(dragged, { type: 'folder', folderId: folder })
      );
    });

    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        folder
      )
    );
  });

  it('re-parents to the top level when dropped on the root zone', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text', parentId: folder });

    const view = mountDnd(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        folder
      )
    );

    await act(async () => {
      view.result.current.dnd.onDragEnd(
        dragEnd(
          { type: 'node', nodeId: doc, title: 'Doc', kind: 'text' },
          { type: 'root' }
        )
      );
    });

    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.has(doc)).toBe(false)
    );
  });

  it('does nothing when the drop lands outside every target', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text', parentId: folder });

    const view = mountDnd(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        folder
      )
    );

    await act(async () => {
      view.result.current.dnd.onDragEnd(
        dragEnd({ type: 'node', nodeId: doc, title: 'Doc', kind: 'text' }, null)
      );
    });

    // A cancelled drag is not a move to the top level — the node stays put.
    expect(view.result.current.data.containment.parentOf.get(doc)).toBe(folder);
    expect(graph.errors).toEqual([]);
  });

  it('copies instead of moving when the copy modifier is held', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountDnd(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    // dnd-kit surfaces no modifier state on drop, so the drag tracks it from
    // the window — which is why the gesture is reproduced here as the events
    // the browser would deliver, not as a flag passed into the handler.
    const dragged: DriveDragData = {
      type: 'node',
      nodeId: doc,
      title: 'Doc',
      kind: 'text',
    };
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
      );
      view.result.current.dnd.onDragEnd(
        dragEnd(dragged, { type: 'folder', folderId: folder })
      );
    });

    // A copy leaves the original where it was and adds a duplicate in the
    // target — a move would have emptied the source location.
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(3));
    const containment = view.result.current.data.containment;
    expect(containment.parentOf.has(doc)).toBe(false);
    expect(containment.childrenOf.get(folder)).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Alt', altKey: false })
      );
    });
  });

  it('suffixes a copy dropped back into the folder it came from', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text', parentId: folder });

    const view = mountDnd(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Alt', altKey: true })
      );
      view.result.current.dnd.onDragEnd(
        dragEnd(
          { type: 'node', nodeId: doc, title: 'Doc', kind: 'text' },
          { type: 'folder', folderId: folder }
        )
      );
    });

    // Same folder ⇒ the duplicate would be a same-named sibling, so it takes
    // the "(copy)" suffix. A copy to a different folder keeps its name.
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(3));
    const titles = view.result.current.data.nodes
      .map((node) => node.title)
      .sort();
    expect(titles).toEqual(['Doc', 'Doc (copy)', 'Folder']);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Alt', altKey: false })
      );
    });
  });

  it('marks a folder invalid as a target while dragging it', async () => {
    graph = await openTestGraph();
    const root = await graph.node('Root');
    const child = await graph.node('Child', { parentId: root });
    const other = await graph.node('Other');

    const view = mountDnd(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(3));

    act(() => {
      view.result.current.dnd.onDragStart(
        dragStart({ type: 'node', nodeId: root, title: 'Root', kind: 'folder' })
      );
    });

    const state = view.result.current.dnd.dragState;
    // Itself and its subtree cannot receive it; an unrelated folder can. The
    // highlight has to agree with the guard, or the user is invited to make a
    // drop that will be refused.
    expect(state?.isInvalidTarget(root)).toBe(true);
    expect(state?.isInvalidTarget(child)).toBe(true);
    expect(state?.isInvalidTarget(other)).toBe(false);

    act(() => view.result.current.dnd.endDrag());
    expect(view.result.current.dnd.dragState).toBeNull();
  });
});

describe('choosing a drop target among overlapping zones', () => {
  /** A droppable candidate in the shape dnd-kit hands the ranking. */
  const zone = (target: DriveDropData) => ({
    id: target.type === 'folder' ? target.folderId : 'root',
    data: { droppableContainer: { data: { current: target } } },
  });

  it('prefers a folder over the root zone the canvas is wrapped in', () => {
    // The whole canvas is a root drop target, so a folder inside it is always
    // hit together with the root — the folder has to win or no folder could
    // ever receive a drop.
    const ranked = preferFolderTarget([
      zone({ type: 'root' }),
      zone({ type: 'folder', folderId: 'knr_folder' }),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.id).toBe('knr_folder');
  });

  it('resolves truly empty canvas to the top level', () => {
    const ranked = preferFolderTarget([zone({ type: 'root' })]);
    expect(ranked.map((hit) => hit.id)).toEqual(['root']);
  });

  it('leaves the hits alone when neither zone is under the pointer', () => {
    expect(preferFolderTarget([])).toEqual([]);
  });
});
