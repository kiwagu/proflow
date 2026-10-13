/**
 * How the worker reaches the database, and why it does not open one.
 *
 * The local database is exclusive: one PGlite worker holds its files, and
 * tabs only cope because they elect a leader among themselves. The agent
 * worker is nested, so a client opened there contends with the page for the
 * same files — the page's boot then fails outright. These cases pin the
 * mechanism that replaced it: every port is a message the page answers from
 * the single client it owns.
 */
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import {
  createPortChannel,
  createProxyDocumentRepository,
  createProxyLists,
  createProxySemanticSearch,
} from './proxy-ports';

/**
 * A worker scope wired straight to a page double: what the worker posts is
 * answered by `serve`, and the answer is dispatched back as a message.
 */
function connected(
  serve: (port: string, method: string, args: unknown[]) => unknown
) {
  const listeners: ((event: MessageEvent<unknown>) => void)[] = [];
  const posted: { port: string; method: string; args: unknown[] }[] = [];
  const scope = {
    postMessage: (message: {
      type: string;
      id: string;
      port: string;
      method: string;
      args: unknown[];
    }) => {
      posted.push({
        port: message.port,
        method: message.method,
        args: message.args,
      });
      void (async () => {
        let reply: Record<string, unknown>;
        try {
          reply = {
            type: 'port-result',
            id: message.id,
            value: await serve(message.port, message.method, message.args),
          };
        } catch (error) {
          reply = {
            type: 'port-result',
            id: message.id,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        for (const listener of listeners)
          listener({ data: reply } as MessageEvent<unknown>);
      })();
    },
    addEventListener: (
      _type: 'message',
      handler: (event: MessageEvent<unknown>) => void
    ) => {
      listeners.push(handler);
    },
  };
  // The channel's types describe the real protocol; the double stands in for
  // a worker scope, which no test environment provides.
  const channel = createPortChannel(
    scope as unknown as Parameters<typeof createPortChannel>[0]
  );
  return { channel, posted };
}

describe('the agent worker ports', () => {
  it('asks the page for a document instead of reading a database', async () => {
    const meta = { id: 'doc-1', title: 'Notes' };
    const { channel, posted } = connected(() =>
      // The page answers with a flattened Result: neverthrow's Ok is a class
      // instance, and structured cloning would strip its prototype.
      ({ ok: true, value: { meta, content: null } })
    );
    const documents = createProxyDocumentRepository(channel);

    const loaded = await documents.load('doc-1');

    expect(posted).toEqual([
      { port: 'documents', method: 'load', args: ['doc-1'] },
    ]);
    expect(loaded.isOk()).toBe(true);
    expect(loaded._unsafeUnwrap().meta).toEqual(meta);
  });

  it("rebuilds the page's failure as a failed Result, not a throw", async () => {
    const { channel } = connected(() => ({
      ok: false,
      error: 'no such document',
    }));
    const documents = createProxyDocumentRepository(channel);

    const loaded = await documents.load('missing');

    expect(loaded.isErr()).toBe(true);
    expect(loaded._unsafeUnwrapErr()).toBe('no such document');
  });

  it('rejects when the page cannot serve the call at all', async () => {
    const { channel } = connected(() => {
      throw new Error('the page serves no database ports');
    });
    const documents = createProxyDocumentRepository(channel);

    await expect(documents.load('doc-1')).rejects.toThrow(
      'the page serves no database ports'
    );
  });

  it('carries search through the same channel', async () => {
    const hits = [{ documentId: 'doc-1', score: 0.9 }];
    const { channel, posted } = connected(() => ({ ok: true, value: hits }));
    const search = createProxySemanticSearch(channel);

    const found = await search.search('notes', { limit: 5 });

    expect(posted).toEqual([
      { port: 'search', method: 'search', args: ['notes', { limit: 5 }] },
    ]);
    expect(found._unsafeUnwrap()).toEqual(hits);
  });

  it('serves the list readers as plain values', async () => {
    const docs = [{ id: 'doc-1' }];
    const { channel, posted } = connected((_port, method) =>
      method === 'listDocuments' ? docs : []
    );
    const lists = createProxyLists(channel);

    expect(await lists.listDocuments()).toEqual(docs);
    expect(await lists.listFiles()).toEqual([]);
    expect(posted.map((p) => p.method)).toEqual(['listDocuments', 'listFiles']);
  });

  it('keeps concurrent calls apart', async () => {
    // Each call is keyed by its own id, so two in flight cannot take each
    // other's answer — the failure this would hide is a tool silently
    // reading another tool's document.
    const { channel } = connected((_port, _method, args) => ({
      ok: true,
      value: { meta: { id: args[0] }, content: null },
    }));
    const documents = createProxyDocumentRepository(channel);

    const [a, b] = await Promise.all([
      documents.load('doc-a'),
      documents.load('doc-b'),
    ]);

    expect(a._unsafeUnwrap().meta.id).toBe('doc-a');
    expect(b._unsafeUnwrap().meta.id).toBe('doc-b');
  });

  it("stamps a writer of its own rather than claiming the page's", () => {
    const { channel } = connected(() => ({ ok: true, value: true }));
    const documents = createProxyDocumentRepository(channel);
    expect(documents.writer).toBe('agent-worker');
  });

  it('leaves cache invalidation to whoever holds the cache', () => {
    const { channel, posted } = connected(() => ({ ok: true, value: null }));
    const documents = createProxyDocumentRepository(channel);
    documents.invalidate('doc-1');
    expect(posted).toEqual([]);
  });
});

describe('the page side of the ports', () => {
  it('flattens a Result and dispatches by port and method', async () => {
    const { callAgentPort, toWireValue } = await import('@workspace/ai-agent');
    const load = vi.fn(async () =>
      ok({ meta: { id: 'doc-1' }, content: null })
    );
    const ports = {
      documents: { load } as never,
      search: {} as never,
      listDocuments: async () => [],
      listFiles: async () => [],
    };

    const value = await callAgentPort(ports, 'documents', 'load', ['doc-1']);

    expect(load).toHaveBeenCalledWith('doc-1');
    expect(toWireValue(value)).toEqual({
      ok: true,
      value: { meta: { id: 'doc-1' }, content: null },
    });
  });

  it('flattens a failed Result without throwing', async () => {
    const { toWireValue } = await import('@workspace/ai-agent');
    expect(toWireValue(err('denied'))).toEqual({ ok: false, error: 'denied' });
  });

  it('refuses a method it does not serve', async () => {
    const { callAgentPort } = await import('@workspace/ai-agent');
    const ports = {
      documents: {} as never,
      search: {} as never,
      listDocuments: async () => [],
      listFiles: async () => [],
    };
    // A typo must fail loudly: resolving it would look to the agent like a
    // document that does not exist.
    await expect(
      callAgentPort(ports, 'documents', 'loadd', ['doc-1'])
    ).rejects.toThrow('unknown documents port method: loadd');
  });
});
