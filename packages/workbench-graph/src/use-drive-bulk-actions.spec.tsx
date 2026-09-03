import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphServicesProvider } from './graph-services.js';
import { closeTestGraph, openTestGraph, type TestGraph } from './testing.js';
import { useDriveBulkActions } from './use-drive-bulk-actions.js';
import { useDriveData } from './use-drive-data.js';
import { useDriveMutations } from './use-drive-mutations.js';
import { useTrashLens } from './use-lenses.js';

/**
 * Bulk actions over a selection. The summary is the interesting part: it must
 * report what the local store actually accepted, so a refused id is visible as
 * skipped rather than folded into a cheerful total.
 */

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

function mountBulk(open: TestGraph) {
  const cleared: number[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GraphServicesProvider services={open.services}>
      {children}
    </GraphServicesProvider>
  );
  const view = renderHook(
    () => {
      const data = useDriveData();
      const mutations = useDriveMutations(data.containment);
      return {
        data,
        mutations,
        trash: useTrashLens(),
        bulk: useDriveBulkActions({
          mutations,
          clearSelection: () => cleared.push(1),
        }),
      };
    },
    { wrapper }
  );
  return { view, cleared };
}

describe('bulk actions over a selection', () => {
  it('trashes every selected node and reports an honest count', async () => {
    graph = await openTestGraph();
    const first = await graph.node('One', { kind: 'text' });
    const second = await graph.node('Two', { kind: 'text' });

    const { view, cleared } = mountBulk(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    await act(async () => {
      await view.result.current.bulk.trashMany([first, second]);
    });

    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(2)
    );
    expect(view.result.current.bulk.summary).toEqual({ done: 2, skipped: 0 });
    // The selection is cleared once the action settles — the rows it named are
    // no longer in the lens the user is looking at.
    expect(cleared).toHaveLength(1);
  });

  it('counts a refused id as skipped instead of hiding it', async () => {
    graph = await openTestGraph();
    const real = await graph.node('Real', { kind: 'text' });

    const { view } = mountBulk(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(1));

    await act(async () => {
      await view.result.current.bulk.trashMany([
        real,
        'knr_000000000000001a.0000000000',
      ]);
    });

    expect(view.result.current.bulk.summary).toEqual({ done: 1, skipped: 1 });
    // The one that worked still happened: a partial failure is never a rollback.
    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(1)
    );
    expect(graph.errors).toHaveLength(1);
  });

  it('stars a whole selection at once', async () => {
    graph = await openTestGraph();
    const first = await graph.node('One', { kind: 'text' });
    const second = await graph.node('Two', { kind: 'text' });

    const { view } = mountBulk(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    await act(async () => {
      await view.result.current.bulk.starMany([first, second], true);
    });

    await waitFor(() => expect(view.result.current.data.starred.size).toBe(2));
    expect(view.result.current.bulk.summary).toEqual({ done: 2, skipped: 0 });
  });

  it('moves a selection into a folder, skipping the move that would cycle', async () => {
    graph = await openTestGraph();
    const target = await graph.node('Target');
    const doc = await graph.node('Doc', { kind: 'text' });
    const child = await graph.node('Child', { parentId: target });

    const { view } = mountBulk(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(3));

    await act(async () => {
      // `target` into its own child is the cycle; the other two are fine.
      await view.result.current.bulk.moveMany([doc, target], child);
    });

    expect(view.result.current.bulk.summary).toEqual({ done: 1, skipped: 1 });
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(child)
    );
    expect(view.result.current.data.containment.parentOf.get(child)).toBe(
      target
    );
  });

  it('purges a trashed selection for good', async () => {
    graph = await openTestGraph();
    const first = await graph.node('One', { kind: 'text' });
    const second = await graph.node('Two', { kind: 'text' });

    const { view } = mountBulk(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    await act(async () => {
      await view.result.current.bulk.trashMany([first, second]);
    });
    await waitFor(() =>
      expect(view.result.current.trash.nodes).toHaveLength(2)
    );

    await act(async () => {
      await view.result.current.bulk.purgeMany([first, second]);
    });

    await waitFor(() => expect(view.result.current.trash.isEmpty).toBe(true));
    expect(view.result.current.bulk.summary).toEqual({ done: 2, skipped: 0 });
  });

  it('does nothing at all for an empty selection', async () => {
    graph = await openTestGraph();
    const { view, cleared } = mountBulk(graph);
    await waitFor(() => expect(view.result.current.bulk).toBeDefined());

    await act(async () => {
      await view.result.current.bulk.trashMany([]);
    });

    // No summary to dismiss and no selection cleared — an empty action is not
    // an action, and showing "0 done" would be noise.
    expect(view.result.current.bulk.summary).toBeNull();
    expect(cleared).toHaveLength(0);
  });
});
