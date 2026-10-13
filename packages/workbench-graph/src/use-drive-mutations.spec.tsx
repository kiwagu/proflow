import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphServicesProvider } from './graph-services.js';
import {
  openTestGraph,
  TEST_SPACE,
  type TestGraph,
  closeTestGraph,
} from './testing.js';
import { useDriveData } from './use-drive-data.js';
import { useDriveMutations } from './use-drive-mutations.js';

/**
 * What the drive's structural gestures do, exercised against a real local
 * store. The claim under test is not "the hook calls the repository" — it is
 * that a gesture changes the rows the canvas reads, without a refresh, which
 * is the whole reason the surface moved off server fetches.
 */

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

/** Mounts the data + mutations pair the way the workbench composes them. */
function mountDrive(open: TestGraph) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GraphServicesProvider services={open.services}>
      {children}
    </GraphServicesProvider>
  );
  return renderHook(
    () => {
      const data = useDriveData();
      return { data, mutations: useDriveMutations(data.containment) };
    },
    { wrapper }
  );
}

describe('moving a node on the drive', () => {
  it('reports a refused move with a way to try it again', async () => {
    graph = await openTestGraph();
    const source = await graph.node('Source');
    const doc = await graph.node('Doc', { kind: 'text', parentId: source });
    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        source
      )
    );

    // A target the move contract refuses (not a node id at all): the store
    // answers with an error, and the surface reports it.
    const nowhere = 'not-a-node-id';
    let accepted = true;
    await act(async () => {
      accepted = await view.result.current.mutations.moveNode(doc, nowhere);
    });
    expect(accepted).toBe(false);
    expect(graph.reported).toHaveLength(1);
    expect(graph.reported[0]?.key).toBe(`move:${doc}`);
    const retry = graph.reported[0]?.retry;
    expect(retry).toBeTypeOf('function');

    // Retrying repeats the same move, and a store that still refuses is
    // reported again rather than silently dropped.
    let again = true;
    await act(async () => {
      again = await retry!();
    });
    expect(again).toBe(false);
    expect(graph.reported).toHaveLength(2);
    // Under the same key: the host replaces the notice instead of stacking.
    expect(graph.reported[1]?.key).toBe(`move:${doc}`);
  });

  it('re-parents it, and the canvas follows without a refetch', async () => {
    graph = await openTestGraph();
    const source = await graph.node('Source');
    const target = await graph.node('Target');
    const doc = await graph.node('Doc', { kind: 'text', parentId: source });

    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        source
      )
    );

    await act(async () => {
      await view.result.current.mutations.moveNode(doc, target);
    });

    // No refresh call anywhere: the live query re-delivers because the rows
    // under it changed.
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        target
      )
    );
    expect(graph.errors).toEqual([]);

    const ops = await graph.db.query<{ op: string }>(
      `select op from graph_op_journal where space_id = $1 order by id`,
      [TEST_SPACE]
    );
    const opNames = ops.rows.map((o) => o.op);
    expect(opNames.slice(-1)).toEqual(['move_node']);
    expect(opNames).not.toContain('remove_edge');
    expect(opNames).not.toContain('upsert_edge');
  });

  it('moves a node to the top level by dropping its containment edge', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text', parentId: folder });

    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        folder
      )
    );

    await act(async () => {
      await view.result.current.mutations.moveNode(doc, null);
    });

    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.has(doc)).toBe(false)
    );

    const ops = await graph.db.query<{ op: string }>(
      `select op from graph_op_journal where space_id = $1 order by id`,
      [TEST_SPACE]
    );
    const opNames = ops.rows.map((o) => o.op);
    expect(opNames.slice(-1)).toEqual(['move_node']);
    expect(opNames).not.toContain('remove_edge');
    expect(opNames).not.toContain('upsert_edge');
    expect(view.result.current.data.containment.parentOf.has(doc)).toBe(false);
  });

  it('refuses to move a folder into its own subtree, and says so', async () => {
    graph = await openTestGraph();
    const root = await graph.node('Root');
    const child = await graph.node('Child', { parentId: root });

    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(child)).toBe(
        root
      )
    );

    const opsBefore = await graph.db.query<{ op: string }>(
      `select op from graph_op_journal where space_id = $1 order by id`,
      [TEST_SPACE]
    );

    let accepted = true;
    await act(async () => {
      accepted = await view.result.current.mutations.moveNode(root, child);
    });

    expect(accepted).toBe(false);
    // The user is told; the tree is untouched (the child keeps its parent, and
    // the root did not acquire one).
    expect(graph.errors).toHaveLength(1);
    expect(view.result.current.data.containment.parentOf.get(child)).toBe(root);
    expect(view.result.current.data.containment.parentOf.has(root)).toBe(false);

    const opsAfter = await graph.db.query<{ op: string }>(
      `select op from graph_op_journal where space_id = $1 order by id`,
      [TEST_SPACE]
    );
    expect(opsAfter.rows).toEqual(opsBefore.rows);
  });

  it('reports repository error to host without partial detach when move fails', async () => {
    graph = await openTestGraph();
    const source = await graph.node('Source');
    const target = await graph.node('Target');
    const doc = await graph.node('Doc', { kind: 'text', parentId: source });

    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        source
      )
    );

    await graph.db.query(
      `alter table graph_op_journal add constraint no_move check (op <> 'move_node')`
    );

    let accepted = true;
    await act(async () => {
      accepted = await view.result.current.mutations.moveNode(doc, target);
    });

    expect(accepted).toBe(false);
    expect(graph.errors).toHaveLength(1);
    expect(view.result.current.data.containment.parentOf.get(doc)).toBe(source);
  });

  it('treats a drop where the node already is as a success that changes nothing', async () => {
    graph = await openTestGraph();
    const folder = await graph.node('Folder');
    const doc = await graph.node('Doc', { kind: 'text', parentId: folder });

    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.parentOf.get(doc)).toBe(
        folder
      )
    );

    let accepted = false;
    await act(async () => {
      accepted = await view.result.current.mutations.moveNode(doc, folder);
    });

    expect(accepted).toBe(true);
    expect(graph.errors).toEqual([]);
    expect(view.result.current.data.containment.parentOf.get(doc)).toBe(folder);
  });

  it('renames a node as one local transaction and one rename_node journal op', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Old Title', { kind: 'text' });

    const view = mountDrive(graph);
    await waitFor(() =>
      expect(view.result.current.data.containment.byId.get(doc)?.title).toBe(
        'Old Title'
      )
    );

    let accepted = false;
    await act(async () => {
      accepted = await view.result.current.mutations.renameNode(
        doc,
        'New Title'
      );
    });

    expect(accepted).toBe(true);
    await waitFor(() =>
      expect(view.result.current.data.containment.byId.get(doc)?.title).toBe(
        'New Title'
      )
    );

    const ops = await graph.db.query<{ op: string }>(
      `select op from graph_op_journal where space_id = $1 order by id`,
      [TEST_SPACE]
    );
    const opNames = ops.rows.map((o) => o.op);
    expect(opNames.slice(-1)).toEqual(['rename_node']);
    expect(graph.errors).toEqual([]);
  });
});

describe('copying a node on the drive', () => {
  it('duplicates the subtree into the target under new ids', async () => {
    graph = await openTestGraph();
    const source = await graph.node('Source');
    await graph.node('Child', { kind: 'text', parentId: source });
    const target = await graph.node('Target');

    const view = mountDrive(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(3));

    await act(async () => {
      await view.result.current.mutations.copyNode(
        source,
        target,
        'Source (copy)'
      );
    });

    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(5));
    const containment = view.result.current.data.containment;
    const copy = [...containment.byId.values()].find(
      (node) => node.title === 'Source (copy)'
    );
    expect(copy).toBeDefined();
    // The copy lands in the target and brings its child with it, under ids of
    // its own — the original subtree is untouched.
    expect(containment.parentOf.get(copy!.id)).toBe(target);
    expect(containment.childrenOf.get(copy!.id)).toHaveLength(1);
    expect(containment.parentOf.get(source)).toBeUndefined();
  });

  it('refuses to copy a folder into its own subtree', async () => {
    graph = await openTestGraph();
    const root = await graph.node('Root');
    const child = await graph.node('Child', { parentId: root });

    const view = mountDrive(graph);
    await waitFor(() => expect(view.result.current.data.nodes).toHaveLength(2));

    let accepted = true;
    await act(async () => {
      accepted = await view.result.current.mutations.copyNode(root, child);
    });

    expect(accepted).toBe(false);
    expect(graph.errors).toHaveLength(1);
    expect(view.result.current.data.nodes).toHaveLength(2);
  });
});

describe('reporting a refused command', () => {
  it('tells the host instead of throwing at the user', async () => {
    graph = await openTestGraph();
    const view = mountDrive(graph);
    await waitFor(() => expect(view.result.current.mutations).toBeDefined());

    let accepted = true;
    await act(async () => {
      accepted = await view.result.current.mutations.renameNode(
        'knr_000000000000000f.0000000000',
        'Nowhere'
      );
    });

    expect(accepted).toBe(false);
    expect(graph.errors[0]).toContain('not in the local replica');
  });
});
