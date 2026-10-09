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
} = vi.hoisted(() => {
  const kick = vi.fn();
  const watchSpace = vi.fn((_spaceId: string, _hooks: unknown) => ({
    stop: vi.fn(),
    kick,
  }));
  const push = vi.fn(async (_id: string, _doc: unknown, _space: string) => ({
    pushedSeq: 1,
    compacted: false,
  }));
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
    createDocumentSync: vi.fn((_options: { writer: string }) => ({
      watchSpace,
      push,
      pull,
      watch: vi.fn(),
      proposeCompaction: vi.fn(),
    })),
    createSupabaseTransport: vi.fn((_client: unknown) => ({})),
    createPgliteLedger: vi.fn((_db: unknown) => ({})),
    createBrowserClient: vi.fn((_url: string, _key: string) => ({})),
    materializeDocuments: vi.fn(async (_db: unknown, _space: string) => 0),
    listAwaitingDocuments: vi.fn(async (_db: unknown): Promise<string[]> => []),
    listUnpushedDocuments: vi.fn(async (_db: unknown): Promise<string[]> => [
      'doc-held',
    ]),
  };
});

vi.mock('@workspace/doc-sync', () => ({
  createDocumentSync,
  createSupabaseTransport,
  createPgliteLedger,
}));
vi.mock('@supabase/ssr', () => ({ createBrowserClient }));
vi.mock('@workspace/persistence-pglite', () => ({
  materializeDocuments,
  listAwaitingDocuments,
  listUnpushedDocuments,
}));

import { ok } from 'neverthrow';
import type { ISettingsStore } from '@workspace/domain';
import type {
  AppDb,
  DocumentChanged,
  DocumentCrdtStore,
} from '@workspace/persistence-pglite';
import { PUSH_DEBOUNCE_MS, startDocumentSync } from './document-sync';

const IDENTITY = { userId: 'user-1', spaceId: 'spc_abc.01m2' };
const CONFIGURED = JSON.stringify({
  url: 'https://server.test',
  key: 'publishable-key',
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
  const store = {
    syncable,
    syncJournal: { append: vi.fn() },
    onChanged: vi.fn((next: (event: DocumentChanged) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
  } as unknown as DocumentCrdtStore;
  const change = (id: string, source: 'local' | 'remote') =>
    listener?.({ id, source, tree: { root: { type: 'root' } }, markdown: '' });
  return { store, syncable, change };
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
    const { store, syncable } = stubStore();
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
      'publishable-key'
    );
    expect(createDocumentSync).toHaveBeenCalledTimes(1);
    expect(materializeDocuments).toHaveBeenCalledWith(db, 'spc_abc.01m2');
    expect(watchSpace).toHaveBeenCalledWith(
      'spc_abc.01m2',
      expect.objectContaining({ open: expect.any(Function) })
    );
    expect(pull).toHaveBeenCalledWith('doc-awaiting', { id: 'doc-awaiting' });
    expect(syncable).toHaveBeenCalledWith('doc-held');
    expect(push).toHaveBeenCalledWith(
      'doc-held',
      { id: 'doc-held' },
      'spc_abc.01m2'
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
      'spc_abc.01m2'
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
      'spc_abc.01m2'
    );
    expect(push).toHaveBeenCalledWith(
      'doc-offline',
      { id: 'doc-offline' },
      'spc_abc.01m2'
    );
    expect(createDocumentSync).toHaveBeenCalledTimes(1);
    handle.stop();
  });
});
