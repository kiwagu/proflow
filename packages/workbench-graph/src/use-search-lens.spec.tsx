import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphServicesProvider } from './graph-services.js';
import { SearchLens, type SearchLensLabels } from './search-lens.js';
import { closeTestGraph, openTestGraph, type TestGraph } from './testing.js';
import { useSearchLens } from './use-search-lens.js';

/**
 * The search lens over the local content index. What matters is that a term
 * resolves through the hybrid engine on the replica (vector + full text over
 * real PGlite, no route), that a hit carries the excerpt the engine matched
 * and the lens SHOWS it, that a stale answer never shows for a newer term,
 * and that a host without an engine gets an honest "unavailable", not a
 * crash.
 */

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

function wrapperFor(open: TestGraph) {
  function TestGraphServicesWrapper({ children }: { children: ReactNode }) {
    return (
      <GraphServicesProvider services={open.services}>
        {children}
      </GraphServicesProvider>
    );
  }
  return TestGraphServicesWrapper;
}

function mountLens(open: TestGraph, initialTerm: string) {
  return renderHook(({ term }) => useSearchLens(term), {
    wrapper: wrapperFor(open),
    initialProps: { term: initialTerm },
  });
}

const LABELS: SearchLensLabels = {
  placeholder: 'Search documents…',
  idle: 'Keep typing',
  searching: 'Searching…',
  noResults: (term) => `Nothing for “${term}”`,
  unavailable: 'Search is not available on this device',
  failed: (message) => `Search failed: ${message}`,
  untitled: 'Untitled',
};

describe('resolving a term', () => {
  it('finds a document by its words and carries the matched excerpt', async () => {
    graph = await openTestGraph({ withSearch: true });
    const hit = await graph.document(
      'Mushroom foraging',
      'Chanterelles grow under birch trees after warm autumn rain.'
    );
    await graph.document(
      'Tax return',
      'Deductible expenses must be filed before the end of March.'
    );

    const view = mountLens(graph, 'chanterelles birch');
    expect(view.result.current.loading).toBe(true);

    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    const [first] = view.result.current.hits;
    expect(first?.documentId).toBe(hit);
    expect(first?.title).toBe('Mushroom foraging');
    expect(first?.excerpt).toContain('Chanterelles');
    expect(view.result.current.reach).toBe('local');
    expect(view.result.current.showEmpty).toBe(false);
  });

  it('says nothing matched when the index holds nothing to rank', async () => {
    // With any document indexed the vector leg is a nearest-neighbour scan
    // and always ranks SOMETHING — the engine's contract, not the lens's.
    // "Nothing matched" is therefore the empty-index answer.
    graph = await openTestGraph({ withSearch: true });

    const view = mountLens(graph, 'zyxwvut');
    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.hits).toEqual([]);
    expect(view.result.current.showEmpty).toBe(true);
    expect(view.result.current.error).toBeNull();
  });

  it('holds back below the minimum term length', async () => {
    graph = await openTestGraph({ withSearch: true });
    const view = mountLens(graph, 'a');
    expect(view.result.current.tooShort).toBe(true);
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.showEmpty).toBe(false);
  });

  it('never shows an answer for a term the user has moved past', async () => {
    graph = await openTestGraph({ withSearch: true });
    await graph.document('Mushroom foraging', 'Chanterelles under birch.');
    await graph.document('Sailing log', 'Reefed the mainsail in a squall.');

    const view = mountLens(graph, 'chanterelles');
    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.hits[0]?.title).toBe('Mushroom foraging');

    view.rerender({ term: 'mainsail' });
    // The old answer is for another term: it must not be shown as this one's.
    expect(view.result.current.resolved).toBe(false);
    expect(view.result.current.hits).toEqual([]);
    expect(view.result.current.loading).toBe(true);

    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.hits[0]?.title).toBe('Sailing log');
  });

  it('suppresses late completions when transitioning through inactive state and returning to same term', async () => {
    graph = await openTestGraph({ withSearch: true });
    await graph.document('Mushroom foraging', 'Chanterelles under birch.');

    const originalSearch = graph.services.search!;
    // Pre-materialize a real Result value so the first request can fulfill synchronously
    // without returning an un-awaited nested Promise to resolveFirstQuery.
    const materializedResult = await originalSearch.search('chanterelles');

    let resolveFirstQuery:
      | ((res: Awaited<ReturnType<typeof originalSearch.search>>) => void)
      | null = null;
    let resolveSecondQuery:
      | ((res: Awaited<ReturnType<typeof originalSearch.search>>) => void)
      | null = null;
    let callCount = 0;

    const deferredProvider = {
      reach: originalSearch.reach,
      search: (_query: string, _opts?: { limit?: number }) => {
        callCount++;
        if (callCount === 1) {
          return new Promise<Awaited<ReturnType<typeof originalSearch.search>>>(
            (resolve) => {
              resolveFirstQuery = resolve;
            }
          );
        }
        if (callCount === 2) {
          return new Promise<Awaited<ReturnType<typeof originalSearch.search>>>(
            (resolve) => {
              resolveSecondQuery = resolve;
            }
          );
        }
        return originalSearch.search(_query, _opts);
      },
    };
    graph.services.search = deferredProvider;

    // 1. Start query A ('chanterelles')
    const view = mountLens(graph, 'chanterelles');
    await waitFor(() => expect(callCount).toBe(1));
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.resolved).toBe(false);

    // 2. Transition to inactive (too short term)
    view.rerender({ term: 'c' });
    expect(view.result.current.tooShort).toBe(true);
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.hits).toEqual([]);

    // 3. Fulfill the first query completely while the lens remains inactive.
    // resolveFirstQuery receives an already-materialized Result, and act flushes
    // microtasks so any .then handler runs while the term is still 'c'.
    await act(async () => {
      resolveFirstQuery!(materializedResult);
      await Promise.resolve();
    });

    // Assert that the lens is still inactive and the late result did not leak into hits or resolved
    expect(view.result.current.tooShort).toBe(true);
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.resolved).toBe(false);
    expect(view.result.current.hits).toEqual([]);

    // 4. Return to query A ('chanterelles') while second request is still pending
    view.rerender({ term: 'chanterelles' });
    await waitFor(() => expect(callCount).toBe(2));

    // Must NOT reuse the late answer; must remain loading while fresh request is pending
    expect(view.result.current.resolved).toBe(false);
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.hits).toEqual([]);
    expect(view.result.current.error).toBeNull();

    // 5. Fresh query resolves when resolveSecondQuery is invoked
    await act(async () => {
      resolveSecondQuery!(materializedResult);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.hits[0]?.title).toBe('Mushroom foraging');
  });

  it('is honestly unavailable when the host wired no engine', async () => {
    graph = await openTestGraph();
    const view = mountLens(graph, 'anything');
    expect(view.result.current.unavailable).toBe(true);
    expect(view.result.current.reach).toBeNull();
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.hits).toEqual([]);
  });

  it('reports provider Result error and clears stale hits', async () => {
    graph = await openTestGraph({ withSearch: true });
    await graph.document('Mushroom foraging', 'Chanterelles under birch.');

    const originalSearch = graph.services.search!;
    let failNext = false;
    const providerWithFailure = {
      reach: originalSearch.reach,
      search: async (_query: string, _opts?: { limit?: number }) => {
        if (failNext) {
          return {
            isOk: () => false as const,
            isErr: () => true as const,
            error: 'Simulated provider failure',
            value: undefined,
          } as unknown as Awaited<ReturnType<typeof originalSearch.search>>;
        }
        return originalSearch.search(_query, _opts);
      },
    };
    graph.services.search = providerWithFailure;

    const view = mountLens(graph, 'chanterelles');
    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.hits).toHaveLength(1);
    expect(view.result.current.error).toBeNull();

    failNext = true;
    view.rerender({ term: 'birch' });

    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.error).toBe('Simulated provider failure');
    expect(view.result.current.hits).toEqual([]);
    expect(view.result.current.showEmpty).toBe(false);
    expect(view.result.current.loading).toBe(false);
  });

  it('reports rejected Promise error and clears stale hits', async () => {
    graph = await openTestGraph({ withSearch: true });
    await graph.document('Mushroom foraging', 'Chanterelles under birch.');

    const originalSearch = graph.services.search!;
    let rejectNext = false;
    const providerWithRejection = {
      reach: originalSearch.reach,
      search: async (query: string, opts?: { limit?: number }) => {
        if (rejectNext) {
          throw new Error('Network offline or rejected');
        }
        return originalSearch.search(query, opts);
      },
    };
    graph.services.search = providerWithRejection;

    const view = mountLens(graph, 'chanterelles');
    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.hits).toHaveLength(1);
    expect(view.result.current.error).toBeNull();

    rejectNext = true;
    view.rerender({ term: 'birch' });

    await waitFor(() => expect(view.result.current.resolved).toBe(true));
    expect(view.result.current.error).toBe('Error: Network offline or rejected');
    expect(view.result.current.hits).toEqual([]);
    expect(view.result.current.showEmpty).toBe(false);
    expect(view.result.current.loading).toBe(false);
  });
});

describe('the lens surface', () => {
  it('renders each hit with its excerpt and dispatches a pick', async () => {
    graph = await openTestGraph({ withSearch: true });
    const id = await graph.document(
      'Mushroom foraging',
      'Chanterelles grow under birch trees after rain.'
    );
    const picked: string[] = [];
    const Wrapper = wrapperFor(graph);

    render(
      <Wrapper>
        <SearchLens
          term="chanterelles"
          onTermChange={() => {}}
          onOpenDocument={(hit) => picked.push(hit.documentId)}
          labels={LABELS}
          autoFocus={false}
        />
      </Wrapper>
    );

    const row = await screen.findByTestId('search-lens-result');
    expect(row.textContent).toContain('Mushroom foraging');
    expect(screen.getByTestId('search-lens-snippet').textContent).toContain(
      'Chanterelles'
    );
    expect(screen.getByTestId('search-lens').dataset['reach']).toBe('local');

    act(() => {
      row.click();
    });
    expect(picked).toEqual([id]);
  });

  it('tells the user when there is no engine instead of an empty list', async () => {
    graph = await openTestGraph();
    const Wrapper = wrapperFor(graph);
    render(
      <Wrapper>
        <SearchLens
          term="chanterelles"
          onTermChange={() => {}}
          onOpenDocument={() => {}}
          labels={LABELS}
          autoFocus={false}
        />
      </Wrapper>
    );
    expect(screen.getByTestId('search-lens-unavailable').textContent).toBe(
      LABELS.unavailable
    );
    expect(screen.queryByTestId('search-lens-result')).toBeNull();
  });

  it('renders error UI when search provider reports failure', async () => {
    graph = await openTestGraph({ withSearch: true });
    const originalSearch = graph.services.search!;
    graph.services.search = {
      reach: originalSearch.reach,
      search: async () =>
        ({
          isOk: () => false as const,
          isErr: () => true as const,
          error: 'Index query timeout',
          value: undefined,
        } as unknown as Awaited<ReturnType<typeof originalSearch.search>>),
    };
    const Wrapper = wrapperFor(graph);
    render(
      <Wrapper>
        <SearchLens
          term="chanterelles"
          onTermChange={() => {}}
          onOpenDocument={() => {}}
          labels={LABELS}
          autoFocus={false}
        />
      </Wrapper>
    );

    const errorState = await screen.findByTestId('search-lens-error');
    expect(errorState.textContent).toBe(LABELS.failed('Index query timeout'));
    expect(screen.queryByTestId('search-lens-result')).toBeNull();
  });

  it('renders error UI when search provider promise rejects', async () => {
    graph = await openTestGraph({ withSearch: true });
    const originalSearch = graph.services.search!;
    graph.services.search = {
      reach: originalSearch.reach,
      search: async () => {
        throw new Error('Connection refused');
      },
    };
    const Wrapper = wrapperFor(graph);
    render(
      <Wrapper>
        <SearchLens
          term="chanterelles"
          onTermChange={() => {}}
          onOpenDocument={() => {}}
          labels={LABELS}
          autoFocus={false}
        />
      </Wrapper>
    );

    const errorState = await screen.findByTestId('search-lens-error');
    expect(errorState.textContent).toBe(
      LABELS.failed('Error: Connection refused')
    );
    expect(screen.queryByTestId('search-lens-result')).toBeNull();
  });
});
