import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphServicesProvider } from './graph-services.js';
import { closeTestGraph, openTestGraph, type TestGraph } from './testing.js';
import { useDriveData } from './use-drive-data.js';
import { useDriveMutations } from './use-drive-mutations.js';
import { useStarredLens, useTrashLens } from './use-lenses.js';

/**
 * The Trash and Starred lenses. Both are live queries over the same rows the
 * drive already holds — trash by the node's own `deleted_at`, starred by the
 * per-user state — so the thing worth proving is that trashing or starring
 * moves an item BETWEEN the lenses with nothing else asked to refresh.
 */

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

function mountLenses(open: TestGraph) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GraphServicesProvider services={open.services}>
      {children}
    </GraphServicesProvider>
  );
  return renderHook(
    () => {
      const data = useDriveData();
      return {
        data,
        mutations: useDriveMutations(data.containment),
        trash: useTrashLens(),
        starred: useStarredLens(),
      };
    },
    { wrapper }
  );
}

describe('the trash lens', () => {
  it('takes a trashed node out of the drive and shows it in trash', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountLenses(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));
    expect(view.result.current.trash.isEmpty).toBe(true);

    await act(async () => {
      await view.result.current.mutations.trashNode(doc);
    });

    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(1)
    );
    expect(view.result.current.trash.nodes[0]?.id).toBe(doc);
    // The same query that lists the drive now excludes it — one predicate,
    // two lenses, no second store.
    expect(view.result.current.data.nodes).toHaveLength(0);
  });

  it('restores a node back into the drive', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountLenses(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));

    await act(async () => {
      await view.result.current.mutations.trashNode(doc);
    });
    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(1)
    );

    await act(async () => {
      await view.result.current.mutations.restoreNode(doc);
    });

    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));
    expect(view.result.current.trash.isEmpty).toBe(true);
  });

  it('leaves the contained subtree to the server cascade, not to itself', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const child = await graph.node('Child', { kind: 'text', parentId: folder });

    const view = mountLenses(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    await act(async () => {
      await view.result.current.mutations.trashNode(folder);
    });

    // Only the folder is trashed locally. The server's cascade trigger is the
    // authority for the subtree, and the replica mirrors its outcome on the
    // next pull rather than reimplementing it and possibly disagreeing.
    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(1)
    );
    expect(view.result.current.data.nodes.map((n) => n.id)).toEqual([child]);
  });

  it('purges a node out of both lenses for good', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountLenses(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));

    await act(async () => {
      await view.result.current.mutations.trashNode(doc);
    });
    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(1)
    );

    await act(async () => {
      await view.result.current.mutations.purgeNode(doc);
    });

    await waitFor(() => expect(view.result.current.trash.isEmpty).toBe(true));
    expect(view.result.current.data.nodes).toHaveLength(0);
  });
});

describe('the starred lens', () => {
  it('follows the star toggle both ways', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountLenses(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));
    expect(view.result.current.starred.isEmpty).toBe(true);

    await act(async () => {
      await view.result.current.mutations.setStarred(doc, true);
    });
    await waitFor(() =>
      expect(view.result.current.starred.nodes.map((n) => n.id)).toEqual([doc])
    );
    // The drive's own overlay sees the same row — one per-user projection.
    expect(view.result.current.data.starred.has(doc)).toBe(true);

    await act(async () => {
      await view.result.current.mutations.setStarred(doc, false);
    });
    await waitFor(() => expect(view.result.current.starred.isEmpty).toBe(true));
  });

  it('drops a starred node from the lens once it is trashed', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Doc', { kind: 'text' });

    const view = mountLenses(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));

    await act(async () => {
      await view.result.current.mutations.setStarred(doc, true);
    });
    await waitFor(() =>
      expect(view.result.current.starred.nodes).toHaveLength(1)
    );

    await act(async () => {
      await view.result.current.mutations.trashNode(doc);
    });

    // The star row survives (restoring brings the star back), but the lens is
    // the JOIN with live nodes, so a trashed node leaves it.
    await waitFor(() => expect(view.result.current.starred.isEmpty).toBe(true));
    expect(view.result.current.trash.nodes).toHaveLength(1);
  });
});
