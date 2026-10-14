import { entityIdRegistry } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The decision to replicate documents and what it is wired to — not the
 * replication itself, which the engine's own suite proves against real
 * databases. Everything below the composition is a recording mock.
 */
const {
  watchSpace,
  kick,
  push,
  pull,
  createDocumentSync,
  createSupabaseTransport,
  createPgliteLedger,
  createBrowserClient,
  materializeDocuments,
  listAwaitingDocuments,
  listUnpushedDocuments,
  resourceIdForDocument,
  nodeAwaitsServer,
  nodeOwnerOfDocument,
  DocumentNotRegisteredError,
  MalformedServerRowError,
} = vi.hoisted(() => {
  class DocumentNotRegisteredError extends Error {}
  class MalformedServerRowError extends Error {}
  const kick = vi.fn();
  const watchSpace = vi.fn((_spaceId: string, _hooks: unknown) => ({
    stop: vi.fn(),
    kick,
  }));
  const push = vi.fn(
    async (
      _id: string,
      _doc: unknown,
      _space: string,
      _resource: string | null
    ) => ({
      pushedSeq: 1,
      compacted: false,
    })
  );
  const pull = vi.fn(async (_id: string, _doc: unknown) => ({
    imported: 1,
    skippedOwn: 0,
    pulledSeq: 1,
  }));
  return {
    watchSpace,
    kick,
    push,
    pull,
    createDocumentSync: vi.fn(
      (_options: {
        writer: string;
        onRefused?: (refusal: { documentId: string; error: Error }) => void;
      }) => ({
        watchSpace,
        push,
        pull,
        proposeCompaction: vi.fn(),
      })
    ),
    createSupabaseTransport: vi.fn((_client: unknown) => ({
      subscribeSpace: vi.fn(() => vi.fn()),
    })),
    createPgliteLedger: vi.fn((_db: unknown) => ({})),
    createBrowserClient: vi.fn(
      (_url: string, _key: string, _options?: unknown) => ({})
    ),
    materializeDocuments: vi.fn(async (_db: unknown, _space: string) => 0),
    listAwaitingDocuments: vi.fn(async (_db: unknown): Promise<string[]> => []),
    listUnpushedDocuments: vi.fn(async (_db: unknown): Promise<string[]> => [
      'doc-held',
    ]),
    // A document the device holds is owned by the node that points at it;
    // `doc-orphan` has no node here.
    resourceIdForDocument: vi.fn(
      async (
        _db: unknown,
        id: string,
        _user: string
      ): Promise<string | null> =>
        id === 'doc-orphan' ? null : `node-of-${id}`
    ),
    // `node-of-doc-new` was made here a moment ago and the graph push has
    // not carried it to the server yet.
    nodeAwaitsServer: vi.fn(
      async (_db: unknown, node: string): Promise<boolean> =>
        node === 'node-of-doc-new'
    ),
    // Whose node a document belongs to: `doc-theirs` belongs to someone else.
    nodeOwnerOfDocument: vi.fn(
      async (_db: unknown, id: string): Promise<string | null> =>
        id === 'doc-theirs' ? 'user-2' : 'user-1'
    ),
    DocumentNotRegisteredError,
    MalformedServerRowError,
  };
});

vi.mock('@workspace/doc-sync', () => ({
  DocumentNotRegisteredError,
  MalformedServerRowError,
  createDocumentSync,
  createSupabaseTransport,
  createPgliteLedger,
}));
vi.mock('@supabase/ssr', () => ({ createBrowserClient }));
vi.mock('@workspace/persistence-pglite', () => ({
  materializeDocuments,
  listAwaitingDocuments,
  listUnpushedDocuments,
  nodeAwaitsServer,
  nodeOwnerOfDocument,
  resourceIdForDocument,
}));

import { ok } from 'neverthrow';
import type { ISettingsStore } from '@workspace/domain';
import type {
  AppDb,
  DocumentChanged,
  DocumentCrdtStore,
} from '@workspace/persistence-pglite';
import { PUSH_DEBOUNCE_MS, startDocumentSync } from './document-sync';

const IDENTITY = {
  userId: 'user-1',
  spaceId: entityIdRegistry.factories.spaceIdFactory.brand('spc_abc.01m2'),
};
const CONFIGURED = JSON.stringify({
  url: 'https://server.test',
  key: 'publishable-key',
  cookie: 'sb-api-auth-token',
});
const db = {} as AppDb;

function settingsHolding(value: string | null): ISettingsStore {
  return {
    get: vi.fn(async () => ok(value)),
    set: vi.fn(async () => ok(undefined)),
    remove: vi.fn(async () => ok(undefined)),
  };
}

function stubStore() {
  let listener: ((event: DocumentChanged) => void) | undefined;
  const syncable = vi.fn(async (id: string) => ({ id }));
  const waitEnded = vi.fn();
  const store = {
    syncable,
    settled: waitEnded,
    syncJournal: { append: vi.fn() },
    onChanged: vi.fn((next: (event: DocumentChanged) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
  } as unknown as DocumentCrdtStore;
  const change = (id: string, source: 'local' | 'remote', localEdits = false) =>
    listener?.({
      id,
      source,
      tree: { root: { type: 'root' } },
      markdown: '',
      localEdits,
    });
  return { store, syncable, waitEnded, change };
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

/**
 * Lets the start-up chain (settings read, materialize, pulls, catch-up)
 * land under real timers; the tests that watch the push debounce switch to
 * fake timers only after that, so an async mock never waits on a clock
 * that is not running.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('starting document replication', () => {
  it('does not build an engine when no configuration was ever received', async () => {
    const { store } = stubStore();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(null),
      store,
      identity: IDENTITY,
    });
    await settled();
    expect(createDocumentSync).not.toHaveBeenCalled();
    expect(materializeDocuments).not.toHaveBeenCalled();
    handle.stop();
  });

  it('materializes, watches the space, pulls what awaits and catches up what changed here', async () => {
    const { store, syncable, waitEnded } = stubStore();
    listAwaitingDocuments.mockResolvedValueOnce(['doc-awaiting']);
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
    });
    await settled();
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://server.test',
      'publishable-key',
      { cookieOptions: { name: 'sb-api-auth-token' } }
    );
    expect(createDocumentSync).toHaveBeenCalledTimes(1);
    expect(materializeDocuments).toHaveBeenCalledWith(db, 'spc_abc.01m2');
    expect(watchSpace).toHaveBeenCalledWith(
      'spc_abc.01m2',
      expect.objectContaining({ open: expect.any(Function) })
    );
    expect(pull).toHaveBeenCalledWith('doc-awaiting', { id: 'doc-awaiting' });
    // The wait is over whether or not the server held a body: a pull that
    // found nothing merges nothing, and the pane showing the wait must be
    // told to look again.
    expect(waitEnded).toHaveBeenCalledWith('doc-awaiting');
    expect(syncable).toHaveBeenCalledWith('doc-held');
    expect(push).toHaveBeenCalledWith(
      'doc-held',
      { id: 'doc-held' },
      'spc_abc.01m2',
      'node-of-doc-held'
    );
    handle.stop();
  });

  it('pushes a document once its local changes have settled, and never for a remote one', async () => {
    const { store, change } = stubStore();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
    });
    await settled();
    push.mockClear();
    vi.useFakeTimers();
    change('doc-typed', 'local');
    change('doc-typed', 'local');
    change('doc-merged', 'remote');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS - 1);
    expect(push).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      'doc-typed',
      { id: 'doc-typed' },
      'spc_abc.01m2',
      'node-of-doc-typed'
    );
    handle.stop();
  });

  it('offers a document no node here points at without an owner, and waits when the server will not register it', async () => {
    const { store, change } = stubStore();
    const onPushFailed = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPushFailed,
    });
    await settled();
    push.mockClear();
    vi.useFakeTimers();
    // A collaborator's edit to a document its creator already registered
    // needs no owner; one the server has no row for cannot be registered
    // without one, and that is waiting, not a failure to report.
    push.mockRejectedValueOnce(new DocumentNotRegisteredError());
    change('doc-orphan', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledWith(
      'doc-orphan',
      { id: 'doc-orphan' },
      'spc_abc.01m2',
      null
    );
    expect(onPushFailed).not.toHaveBeenCalled();
    handle.stop();
  });

  it('does not offer a document whose node the server has not taken yet, and does once the graph push lands', async () => {
    const { store, change } = stubStore();
    const onPushFailed = vi.fn();
    const onPushed = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPushFailed,
      onPushed,
    });
    await settled();
    push.mockClear();
    vi.useFakeTimers();
    change('doc-new', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    // The server checks the node it is told owns the body; one it has not
    // received would be refused, and a refusal is not what this is.
    expect(push).not.toHaveBeenCalled();
    expect(onPushFailed).not.toHaveBeenCalled();

    nodeAwaitsServer.mockResolvedValueOnce(false);
    handle.graphPushed();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledWith(
      'doc-new',
      { id: 'doc-new' },
      'spc_abc.01m2',
      'node-of-doc-new'
    );
    expect(onPushed).toHaveBeenCalledWith('doc-new');

    // Nothing left waiting: another graph push has nothing to retry.
    push.mockClear();
    handle.graphPushed();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).not.toHaveBeenCalled();
    handle.stop();
  });

  it('retries what waited after a graph pull brought rows, and keeps waiting when it still cannot register', async () => {
    const { store, change } = stubStore();
    const onPushFailed = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPushFailed,
    });
    await settled();
    vi.useFakeTimers();
    push.mockRejectedValueOnce(new DocumentNotRegisteredError());
    change('doc-orphan', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    push.mockClear();
    push.mockRejectedValueOnce(new DocumentNotRegisteredError());

    handle.graphPulled();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(1);

    // Still unregistered: still waiting, so the next graph change tries again.
    handle.graphPulled();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).toHaveBeenCalledTimes(2);
    expect(onPushFailed).not.toHaveBeenCalled();
    handle.stop();
  });

  it('a document that waited and is then refused leaves the wait: one report, no retries on graph changes', async () => {
    const { store, change } = stubStore();
    const onPushFailed = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPushFailed,
    });
    await settled();
    vi.useFakeTimers();
    // Not registered yet: it waits for its creator.
    push.mockRejectedValueOnce(new DocumentNotRegisteredError());
    change('doc-orphan', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    // Registered meanwhile, and this user may read it but not edit it.
    push.mockRejectedValueOnce(
      new Error(
        'push insert failed: new row violates row-level security policy'
      )
    );
    handle.graphPulled();
    await vi.advanceTimersByTimeAsync(0);
    expect(onPushFailed).toHaveBeenCalledTimes(1);

    // A refusal is no longer waiting for the graph: graph changes do not
    // send it again (only an edit or the network coming back does).
    push.mockClear();
    handle.graphPulled();
    handle.graphPushed();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).not.toHaveBeenCalled();
    expect(onPushFailed).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('never pushes a document the person may not write, nor reports it, until the scope allows it', async () => {
    const { store, change } = stubStore();
    const onPushFailed = vi.fn();
    let mine = true;
    const mayWrite = vi.fn(
      (row: { owner_user_id: string | null }) =>
        !mine || row.owner_user_id === 'user-1'
    );
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPushFailed,
      mayWrite,
    });
    await settled();
    push.mockClear();
    vi.useFakeTimers();

    change('doc-theirs', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(mayWrite).toHaveBeenCalledWith({ owner_user_id: 'user-2' });
    expect(push).not.toHaveBeenCalled();
    expect(onPushFailed).not.toHaveBeenCalled();
    // Not a wait for the graph, not a failure: graph changes leave it alone.
    handle.graphPulled();
    handle.graphPushed();
    await vi.advanceTimersByTimeAsync(0);
    expect(push).not.toHaveBeenCalled();

    // The scope changed (the role was raised): the next edit goes out.
    mine = false;
    change('doc-theirs', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledWith(
      'doc-theirs',
      { id: 'doc-theirs' },
      'spc_abc.01m2',
      'node-of-doc-theirs'
    );
    handle.stop();
  });

  it("pushes a document of the person's own as before when a scope is given", async () => {
    const { store, change } = stubStore();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      mayWrite: (row) => row.owner_user_id === 'user-1',
    });
    await settled();
    push.mockClear();
    vi.useFakeTimers();
    change('doc-typed', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledWith(
      'doc-typed',
      { id: 'doc-typed' },
      'spc_abc.01m2',
      'node-of-doc-typed'
    );
    handle.stop();
  });

  it('a merge that folded edits made here pushes them once they settle', async () => {
    const { store, change } = stubStore();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
    });
    await settled();
    push.mockClear();
    vi.useFakeTimers();
    change('doc-folded', 'remote', true);
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(push).toHaveBeenCalledWith(
      'doc-folded',
      { id: 'doc-folded' },
      'spc_abc.01m2',
      'node-of-doc-folded'
    );
    handle.stop();
  });

  it('a refused push is reported once per document and withdrawn when one lands', async () => {
    const { store, change } = stubStore();
    const onPushFailed = vi.fn();
    const onPushed = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPushFailed,
      onPushed,
    });
    await settled();
    onPushed.mockClear();
    push.mockClear();
    vi.useFakeTimers();
    push.mockRejectedValueOnce(
      new Error('push insert failed: permission denied')
    );
    change('doc-typed', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(onPushFailed).toHaveBeenCalledTimes(1);
    expect(onPushFailed.mock.calls[0]?.[0]).toBe('doc-typed');
    expect(String(onPushFailed.mock.calls[0]?.[1])).toContain(
      'permission denied'
    );
    // No retry by itself: only the next change, or the network coming
    // back, tries again.
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 5);
    expect(push).toHaveBeenCalledTimes(1);
    change('doc-typed', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    expect(onPushed).toHaveBeenCalledWith('doc-typed');
    handle.stop();
  });

  it('hands a document the server sent something unreadable for to the composition', async () => {
    const { store } = stubStore();
    const onRefused = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onRefused,
    });
    await settled();
    const error = new MalformedServerRowError('writer "tab-1"');
    createDocumentSync.mock.calls[0]?.[0].onRefused?.({
      documentId: 'doc-bad',
      error,
    });
    expect(onRefused).toHaveBeenCalledWith('doc-bad', error);
    handle.stop();
  });

  it('a document refused on its first pull does not hold back the others awaiting theirs', async () => {
    const { store, waitEnded } = stubStore();
    const onPassFailed = vi.fn();
    listAwaitingDocuments.mockResolvedValueOnce(['doc-bad', 'doc-good']);
    pull.mockImplementationOnce(async () => {
      throw new MalformedServerRowError('writer "tab-1"');
    });
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPassFailed,
    });
    await settled();
    expect(pull).toHaveBeenCalledWith('doc-good', { id: 'doc-good' });
    expect(waitEnded).toHaveBeenCalledWith('doc-good');
    // Its body is on the server, unread: the pane keeps saying so.
    expect(waitEnded).not.toHaveBeenCalledWith('doc-bad');
    expect(onPassFailed).not.toHaveBeenCalled();
    handle.stop();
  });

  it('hands a failed pass and a completed one to the composition', async () => {
    const { store } = stubStore();
    const onPassFailed = vi.fn();
    const onPassSettled = vi.fn();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
      onPassFailed,
      onPassSettled,
    });
    await settled();
    const hooks = watchSpace.mock.calls[0]?.[1] as {
      onError: (error: unknown) => void;
      onPass: (outcome: unknown) => void;
    };
    hooks.onError(new Error('heads query failed'));
    expect(onPassFailed).toHaveBeenCalledTimes(1);
    hooks.onPass({ pulled: 0, skipped: 0 });
    expect(onPassSettled).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('a graph pull materializes again, pulls what that brought and runs a pass now', async () => {
    const { store } = stubStore();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
    });
    await settled();
    materializeDocuments.mockClear();
    pull.mockClear();
    listAwaitingDocuments.mockResolvedValueOnce(['doc-arrived']);
    handle.graphPulled();
    await settled();
    expect(materializeDocuments).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledWith('doc-arrived', { id: 'doc-arrived' });
    expect(kick).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it('the network returning runs the catch-up again, failed pushes included', async () => {
    const { store, change } = stubStore();
    const handle = startDocumentSync({
      db,
      settings: settingsHolding(CONFIGURED),
      store,
      identity: IDENTITY,
    });
    await settled();
    vi.useFakeTimers();
    push.mockRejectedValueOnce(new Error('push insert failed: fetch failed'));
    change('doc-offline', 'local');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS);
    vi.useRealTimers();
    push.mockClear();
    materializeDocuments.mockClear();
    window.dispatchEvent(new Event('online'));
    await settled();
    expect(materializeDocuments).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(
      'doc-held',
      { id: 'doc-held' },
      'spc_abc.01m2',
      'node-of-doc-held'
    );
    expect(push).toHaveBeenCalledWith(
      'doc-offline',
      { id: 'doc-offline' },
      'spc_abc.01m2',
      'node-of-doc-offline'
    );
    expect(createDocumentSync).toHaveBeenCalledTimes(1);
    handle.stop();
  });
});
