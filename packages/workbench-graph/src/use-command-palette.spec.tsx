import { act, renderHook, waitFor } from '@testing-library/react';
import type { GraphNode } from '@workspace/persistence-pglite';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphServicesProvider } from './graph-services.js';
import { closeTestGraph, openTestGraph, type TestGraph } from './testing.js';
import {
  activationForKind,
  commitPaletteSelection,
  useCommandPalette,
} from './use-command-palette.js';

/**
 * The command palette over the local title index. What matters is that typing
 * resolves against the replica (no route, no debounce-and-fetch), that the
 * results are the ones the same query would give the search lens, and that a
 * picked node is dispatched by its kind rather than by a chain of ifs.
 */

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

function mountPalette(open: TestGraph) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GraphServicesProvider services={open.services}>
      {children}
    </GraphServicesProvider>
  );
  return renderHook(() => useCommandPalette(), { wrapper });
}

describe('opening the palette', () => {
  it('toggles on the command shortcut and closes on it again', async () => {
    graph = await openTestGraph();
    const view = mountPalette(graph);
    expect(view.result.current.open).toBe(false);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
      );
    });
    expect(view.result.current.open).toBe(true);

    act(() => {
      // The Mac binding is the same handler — one shortcut, no platform sniff.
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true })
      );
    });
    expect(view.result.current.open).toBe(false);
  });

  it('ignores a bare k, so typing in the box does not close it', async () => {
    graph = await openTestGraph();
    const view = mountPalette(graph);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    });
    expect(view.result.current.open).toBe(false);
  });
});

describe('searching from the palette', () => {
  it('finds a node by a prefix of its title, while still typing', async () => {
    graph = await openTestGraph();
    await graph.node('Product Design', { kind: 'text' });
    await graph.node('Unrelated', { kind: 'text' });

    const view = mountPalette(graph);
    act(() => view.result.current.setOpen(true));
    act(() => view.result.current.setTerm('prod'));

    // A prefix match, not an exact one: the index is built for a type-ahead.
    await waitFor(() =>
      expect(view.result.current.items.map((node) => node.title)).toEqual([
        'Product Design',
      ])
    );
    expect(view.result.current.showEmpty).toBe(false);
  });

  it('says nothing matched rather than showing a stale list', async () => {
    graph = await openTestGraph();
    await graph.node('Product Design', { kind: 'text' });

    const view = mountPalette(graph);
    act(() => view.result.current.setOpen(true));
    act(() => view.result.current.setTerm('prod'));
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));

    act(() => view.result.current.setTerm('zzz'));
    await waitFor(() => expect(view.result.current.showEmpty).toBe(true));
    expect(view.result.current.items).toEqual([]);
  });

  it('waits for a term long enough to be worth searching', async () => {
    graph = await openTestGraph();
    await graph.node('Product Design', { kind: 'text' });

    const view = mountPalette(graph);
    act(() => view.result.current.setOpen(true));
    act(() => view.result.current.setTerm('p'));

    // One character matches most of a space; the palette says "keep typing"
    // instead of dumping the whole drive into the box.
    expect(view.result.current.tooShort).toBe(true);
    expect(view.result.current.items).toEqual([]);
    expect(view.result.current.showEmpty).toBe(false);
  });

  it('drops a node from an OPEN palette as soon as it is trashed', async () => {
    graph = await openTestGraph();
    const doc = await graph.node('Product Design', { kind: 'text' });

    const view = mountPalette(graph);
    act(() => view.result.current.setOpen(true));
    act(() => view.result.current.setTerm('product'));
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));

    await act(async () => {
      await graph!.services.commands.trashNode(doc, graph!.services.userId);
    });

    // The term did not change — the ROWS did. A ranked search is a one-shot
    // query, so the palette watches the rows it searched: without that it
    // would keep offering a node that is now in the trash.
    await waitFor(() => expect(view.result.current.items).toEqual([]));
    expect(view.result.current.showEmpty).toBe(true);
  });

  it('starts from an empty box each time it opens', async () => {
    graph = await openTestGraph();
    await graph.node('Product Design', { kind: 'text' });

    const view = mountPalette(graph);
    act(() => view.result.current.setOpen(true));
    act(() => view.result.current.setTerm('product'));
    await waitFor(() => expect(view.result.current.items).toHaveLength(1));

    act(() => view.result.current.setOpen(false));
    act(() => view.result.current.setOpen(true));

    expect(view.result.current.term).toBe('');
    expect(view.result.current.items).toEqual([]);
  });
});

describe('activating a result', () => {
  const node = (kind: string): GraphNode =>
    ({ id: `knr_${kind}`, kind, title: kind }) as GraphNode;

  it('dispatches by the kind s behaviour, not by a chain of ifs', () => {
    expect(activationForKind('folder')).toBe('navigate');
    expect(activationForKind('text')).toBe('read');
    // An unknown kind is inspectable rather than unusable — a new kind slots
    // into the map, and until it does the details panel is a safe default.
    expect(activationForKind('sculpture')).toBe('inspect');

    const seen: string[] = [];
    const handlers = {
      onOpenFolder: () => seen.push('folder'),
      onOpenDocument: () => seen.push('document'),
      onInspect: () => seen.push('inspect'),
    };
    commitPaletteSelection(node('folder'), handlers);
    commitPaletteSelection(node('text'), handlers);
    commitPaletteSelection(node('video'), handlers);
    expect(seen).toEqual(['folder', 'document', 'inspect']);
  });
});
