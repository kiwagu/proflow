/**
 * The agent's ports, served by the page instead of by a second database.
 *
 * The local database is exclusive: it lives in one PGlite worker whose files
 * only one context may hold. Tabs cope because they elect a leader among
 * themselves, but the agent worker is a NESTED worker — it would start a
 * second PGlite worker of its own and contend for the same files, and the
 * page's own boot then fails with "another tab is holding the database". A
 * worker that only reads and writes documents does not need its own client;
 * it needs the one the page already has.
 *
 * So the ports become messages. This mirrors the editor bridge that already
 * exists in this protocol (`read-state` / `apply-edit`): the worker asks, the
 * page answers from the single database it owns, and there is no second
 * opener to contend with. Each call is one round trip keyed by a request id.
 */
import type {
  DocumentContent,
  DocumentKind,
  DocumentMeta,
  EditAuthor,
  FileNode,
  IDocumentRepository,
  ISemanticSearch,
  SearchHit,
  SerializedTree,
} from '@workspace/domain';
import type { FromWorker, ToWorker } from '@workspace/ai-agent';
import { err, ok, type Result } from 'neverthrow';

/** How the worker sends a port call and awaits its answer. */
export type PortChannel = {
  call: (
    port: 'documents' | 'search' | 'lists',
    method: string,
    args: unknown[]
  ) => Promise<unknown>;
};

/**
 * A `Result` as it survives structured cloning.
 *
 * `neverthrow`'s Ok/Err are class instances: cloning them across a worker
 * boundary strips their prototype, so a plain shape crosses and is rebuilt
 * on the far side.
 */
type WireResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Packs a `Result` for the wire. Used by the page side. */
export function toWireResult<T>(result: Result<T, string>): WireResult<T> {
  return result.isOk()
    ? { ok: true, value: result.value }
    : { ok: false, error: result.error };
}

function fromWire<T>(wire: unknown): Result<T, string> {
  const w = wire as WireResult<T>;
  return w.ok ? ok(w.value) : err(w.error);
}

/**
 * The worker's end of the port channel: one call out, one answer back,
 * matched by id.
 *
 * Lives here rather than in the composition root because it is protocol, not
 * wiring — the page's `port-call` handler is its mirror image.
 */
export function createPortChannel(scope: {
  postMessage: (message: FromWorker) => void;
  addEventListener: (
    type: 'message',
    handler: (event: MessageEvent<ToWorker>) => void
  ) => void;
}): PortChannel {
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let ids = 0;

  scope.addEventListener('message', (event) => {
    const message = event.data;
    if (message?.type !== 'port-result') return;
    const settle = pending.get(message.id);
    if (!settle) return;
    pending.delete(message.id);
    if (message.error) settle.reject(new Error(message.error));
    else settle.resolve(message.value);
  });

  return {
    call: (port, method, args) =>
      new Promise((resolve, reject) => {
        const id = `port-${++ids}`;
        pending.set(id, { resolve, reject });
        scope.postMessage({ type: 'port-call', id, port, method, args });
      }),
  };
}

/**
 * The document repository, as a proxy over the channel.
 *
 * `writer` and `invalidate` stay local on purpose: the writer identity
 * belongs to whoever performs the save — the page's repository stamps its
 * own — and invalidation is a cache concern of the context holding the cache.
 */
export function createProxyDocumentRepository(
  channel: PortChannel
): IDocumentRepository {
  const call = (method: string, args: unknown[]) =>
    channel.call('documents', method, args);
  return {
    writer: 'agent-worker',
    invalidate: () => {},
    create: async (input?: {
      kind?: DocumentKind;
      title?: string;
      parentId?: string | null;
      id?: string;
      nodeId?: string;
    }) => fromWire<DocumentMeta>(await call('create', [input])),
    load: async (id: string) =>
      fromWire<{ meta: DocumentMeta; content: DocumentContent | null }>(
        await call('load', [id])
      ),
    save: async (input: {
      id: string;
      tree: SerializedTree;
      markdown: string;
      preview: string;
      author: EditAuthor;
    }) => fromWire<boolean>(await call('save', [input])),
    rename: async (id: string, title: string) =>
      fromWire<void>(await call('rename', [id, title])),
    softDelete: async (id: string) =>
      fromWire<void>(await call('softDelete', [id])),
  };
}

/** Semantic search, as a proxy over the channel. */
export function createProxySemanticSearch(
  channel: PortChannel
): ISemanticSearch {
  return {
    search: async (query: string, opts?: { limit?: number }) =>
      fromWire<SearchHit[]>(
        await channel.call('search', 'search', [query, opts])
      ),
    indexDocument: async (documentId: string) =>
      fromWire<void>(
        await channel.call('search', 'indexDocument', [documentId])
      ),
  };
}

/** The two list readers the agent's tools use, as proxies. */
export function createProxyLists(channel: PortChannel) {
  return {
    listDocuments: () =>
      channel.call('lists', 'listDocuments', []) as Promise<DocumentMeta[]>,
    listFiles: () =>
      channel.call('lists', 'listFiles', []) as Promise<FileNode[]>,
  };
}
