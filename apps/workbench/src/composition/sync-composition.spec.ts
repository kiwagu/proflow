import { entityIdRegistry } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The composition that decides, per browser, which tab syncs, when it
 * starts, what it is built from and when its engines run. The two engine
 * starters are recorded wholesale — their own specs cover what they do with
 * a client; this covers who gets one, and the cadence around them.
 */

const { createBrowserClient, startGraphSync, startDocumentSync, clients } =
  vi.hoisted(() => {
    type Rpc = (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const clients: { rpc: ReturnType<typeof vi.fn<Rpc>> }[] = [];
    const engine = () => ({
      stop: vi.fn(),
      kick: vi.fn(),
      graphPulled: vi.fn(),
      graphPushed: vi.fn(),
      /** What the engine's failed passes still owe; nothing by default. */
      owed: vi.fn((): { sweep?: boolean; full?: boolean } | null => null),
    });
    return {
      clients,
      createBrowserClient: vi.fn(
        (_url: string, _key: string, _options?: unknown) => {
          const client = {
            rpc: vi.fn<Rpc>(async (fn) =>
              fn === 'sync_probe'
                ? {
                    data: [
                      {
                        epoch: 0,
                        graph_changed_at: null,
                        graph_deleted_at: null,
                        documents_changed_at: null,
                        probed_at: new Date().toISOString(),
                      },
                    ],
                    error: null,
                  }
                : { data: null, error: null }
            ),
          };
          clients.push(client);
          return client;
        }
      ),
      startGraphSync: vi.fn(
        (_options: {
          client: unknown;
          onChannel?: (up: boolean) => void;
          onPulled?: (outcome: { applied: number }) => void;
          onPushed?: (outcome: { accepted: number }) => void;
        }) => engine()
      ),
      startDocumentSync: vi.fn(
        (_options: {
          client: unknown;
          peers?: unknown;
          onChannel?: (up: boolean) => void;
        }) => engine()
      ),
    };
  });

vi.mock('@supabase/ssr', () => ({ createBrowserClient }));
vi.mock('@workspace/graph-sync', () => ({}));
vi.mock('@workspace/doc-sync', () => ({}));
vi.mock('@workspace/persistence-pglite', () => ({}));
vi.mock('./sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sync')>()),
  startGraphSync,
}));
vi.mock('./document-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./document-sync')>()),
  startDocumentSync,
}));

import { ok } from 'neverthrow';
import type { ISettingsStore } from '@workspace/domain';
import type {
  AppDb,
  DocumentCrdtStore,
  DocumentPeers,
} from '@workspace/persistence-pglite';
import { rememberSyncSettings, SYNC_SETTINGS_KEY } from './sync';
import { startSync, type StartSyncOptions } from './sync-composition';
import { fakeChannelBus, fakeLocks } from './testing/sync-fakes';

const IDENTITY = {
  userId: 'user-1',
  spaceId: entityIdRegistry.factories.spaceIdFactory.brand(
    'spc_0000000000000001.0000000000'
  ),
};
const SETTING = {
  url: 'https://proflow.local/backend',
  key: 'pk',
  cookie: 'sb-api-auth-token',
};
const SECOND = 1_000;

function settingsStore(initial: string | null = JSON.stringify(SETTING)) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SYNC_SETTINGS_KEY, initial);
  return {
    get: vi.fn(async (key: string) => ok(values.get(key) ?? null)),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return ok(undefined);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
      return ok(undefined);
    }),
  } satisfies ISettingsStore;
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

/** One browser: one lock manager and one channel bus its tabs share. */
function browser() {
  const locks = fakeLocks();
  const bus = fakeChannelBus();
  const journalListeners = new Set<() => void>();
  return {
    locks,
    bus,
    /** A tab of this browser. */
    tab(overrides: Partial<StartSyncOptions> & { visible?: boolean } = {}) {
      let visible = overrides.visible ?? true;
      const visibilityListeners = new Set<() => void>();
      const journal = new Set<() => void>();
      const root = document.createElement('html');
      const handle = startSync({
        db: {} as AppDb,
        settings: settingsStore(),
        store: {} as DocumentCrdtStore,
        identity: IDENTITY,
        documentPeers: { announce: vi.fn(), listen: () => () => undefined },
        onGraphJournaled: (listener) => {
          journal.add(listener);
          journalListeners.add(listener);
          return () => journal.delete(listener);
        },
        locks,
        channel: bus.open('proflow:sync'),
        root,
        page: {
          visible: () => visible,
          onVisibilityChange: (listener) => {
            visibilityListeners.add(listener);
            return () => visibilityListeners.delete(listener);
          },
        },
        ...overrides,
      });
      return {
        handle,
        root,
        /** This tab wrote to the graph journal. */
        journaled() {
          for (const listener of journal) listener();
        },
        setVisible(next: boolean) {
          visible = next;
          for (const listener of visibilityListeners) listener();
        },
      };
    },
  };
}

const graphOf = (call = 0) => startGraphSync.mock.results[call]?.value;
const documentsOf = (call = 0) => startDocumentSync.mock.results[call]?.value;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.clearAllMocks();
  clients.length = 0;
  vi.useFakeTimers();
  setOnline(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('who syncs', () => {
  it('the leader builds the client with the session cookie, and both engines over it', async () => {
    const b = browser();
    const tab = b.tab();
    await flush();
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://proflow.local/backend',
      'pk',
      { cookieOptions: { name: 'sb-api-auth-token' } }
    );
    expect(startGraphSync.mock.calls[0]?.[0].client).toBe(clients[0]);
    expect(startDocumentSync.mock.calls[0]?.[0].client).toBe(clients[0]);
    expect(tab.root.dataset.syncLeader).toBe('1');
    tab.handle.stop();
  });

  it('a second tab of the same browser builds no client and no engine', async () => {
    const b = browser();
    const first = b.tab();
    const second = b.tab();
    await flush();
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    expect(startGraphSync).toHaveBeenCalledTimes(1);
    expect(startDocumentSync).toHaveBeenCalledTimes(1);
    expect(second.root.dataset.syncLeader).toBe('0');
    expect(second.root.dataset.syncChannel).toBeUndefined();
    first.handle.stop();
    second.handle.stop();
  });

  it('hands over: when the leader stops, the next tab builds its own and catches up', async () => {
    const b = browser();
    const first = b.tab();
    const second = b.tab();
    await flush();
    first.handle.stop();
    await flush();
    expect(graphOf(0).stop).toHaveBeenCalledTimes(1);
    expect(documentsOf(0).stop).toHaveBeenCalledTimes(1);
    expect(first.root.dataset.syncLeader).toBe('0');
    expect(second.root.dataset.syncLeader).toBe('1');
    expect(createBrowserClient).toHaveBeenCalledTimes(2);
    // Its graph engine checks the space out with a sweep (the engine's own
    // first cycle); the cadence catches up on top, now and five seconds on.
    expect(startGraphSync).toHaveBeenCalledTimes(2);
    expect(graphOf(1).kick).toHaveBeenCalled();
    second.handle.stop();
  });

  it('a setting stored by an older build (no cookie) starts nothing until the session rewrites it', async () => {
    const settings = settingsStore(
      JSON.stringify({ url: 'https://api.proflow.local', key: 'pk' })
    );
    const b = browser();
    const tab = b.tab({ settings });
    await flush();
    expect(createBrowserClient).not.toHaveBeenCalled();
    expect(tab.root.dataset.syncLeader).toBe('1');

    await rememberSyncSettings(settings, SETTING);
    tab.handle.settingsChanged();
    await flush();
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://proflow.local/backend',
      'pk',
      { cookieOptions: { name: 'sb-api-auth-token' } }
    );
    tab.handle.stop();
  });

  it('starts once the network returns, not once per event', async () => {
    setOnline(false);
    const b = browser();
    const tab = b.tab();
    await flush();
    expect(createBrowserClient).not.toHaveBeenCalled();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    tab.handle.stop();
  });

  it('never starts again once stopped', async () => {
    const b = browser();
    const tab = b.tab();
    await flush();
    tab.handle.stop();
    window.dispatchEvent(new Event('online'));
    tab.handle.settingsChanged();
    await flush();
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  });

  it('without Web Locks no tab syncs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const b = browser();
    const tab = b.tab({ locks: null });
    await flush();
    expect(createBrowserClient).not.toHaveBeenCalled();
    expect(tab.root.dataset.syncLeader).toBe('0');
    tab.handle.stop();
  });
});

describe('what reaches the leader', () => {
  it("a graph write in another tab makes the leader's engine push", async () => {
    const b = browser();
    const leader = b.tab();
    const other = b.tab();
    await flush();
    graphOf().kick.mockClear();
    other.journaled();
    await flush();
    expect(graphOf().kick).toHaveBeenCalledTimes(1);
    leader.handle.stop();
    other.handle.stop();
  });

  it("the leader's own graph write kicks its engine directly", async () => {
    const b = browser();
    const leader = b.tab();
    await flush();
    graphOf().kick.mockClear();
    leader.journaled();
    expect(graphOf().kick).toHaveBeenCalledTimes(1);
    leader.handle.stop();
  });

  it("the document store's announcements of other tabs reach the leader's document engine", async () => {
    const documentPeers: DocumentPeers = {
      announce: vi.fn(),
      listen: () => () => undefined,
    };
    const b = browser();
    const leader = b.tab({ documentPeers });
    await flush();
    expect(startDocumentSync.mock.calls[0]?.[0].peers).toBe(documentPeers);
    leader.handle.stop();
  });

  it('a graph pull that brought rows and a push that landed are handed to the documents', async () => {
    const b = browser();
    const leader = b.tab();
    await flush();
    const options = startGraphSync.mock.calls[0]![0];
    options.onPulled?.({ applied: 0 });
    expect(documentsOf().graphPulled).not.toHaveBeenCalled();
    options.onPulled?.({ applied: 2 });
    expect(documentsOf().graphPulled).toHaveBeenCalledTimes(1);
    options.onPushed?.({ accepted: 1 });
    expect(documentsOf().graphPushed).toHaveBeenCalledTimes(1);
    leader.handle.stop();
  });
});

describe('a pass that failed', () => {
  /**
   * The probe answers once per heartbeat with when each kind last changed;
   * here nothing new is marked. What an engine says its failed passes still
   * owe is asked for again by the next heartbeat all the same, in its own
   * mode — the engines keep that account, whoever asked for the pass.
   */
  async function quietLeader() {
    const b = browser();
    const leader = b.tab();
    await flush();
    await vi.advanceTimersByTimeAsync(6 * SECOND);
    graphOf().kick.mockClear();
    documentsOf().kick.mockClear();
    return leader;
  }

  /** The channel is down in these cases: a heartbeat every 15 s, from 0. */
  const nextHeartbeat = () => vi.advanceTimersByTimeAsync(15 * SECOND);

  it('a graph pass owed is asked for again whatever the probe says, a sweep as a sweep', async () => {
    const leader = await quietLeader();
    await vi.advanceTimersByTimeAsync(9 * SECOND); // the heartbeat at 15 s
    expect(graphOf().kick).not.toHaveBeenCalled();

    graphOf().owed.mockReturnValue({ sweep: false });
    await nextHeartbeat();
    expect(graphOf().kick.mock.calls).toEqual([[]]);

    // A deletion nudge's sweep failed: it is owed as a sweep.
    graphOf().owed.mockReturnValue({ sweep: true });
    await nextHeartbeat();
    expect(graphOf().kick.mock.calls).toEqual([[], [{ sweep: true }]]);

    graphOf().owed.mockReturnValue(null);
    await nextHeartbeat();
    expect(graphOf().kick).toHaveBeenCalledTimes(2);
    leader.handle.stop();
  });

  it('a documents pass owed is asked for again, a full read as a full read', async () => {
    const leader = await quietLeader();
    documentsOf().owed.mockReturnValue({ full: false });
    await vi.advanceTimersByTimeAsync(9 * SECOND);
    expect(documentsOf().kick.mock.calls).toEqual([[]]);
    documentsOf().owed.mockReturnValue({ full: true });
    await nextHeartbeat();
    expect(documentsOf().kick.mock.calls).toEqual([[], [{ full: true }]]);
    documentsOf().owed.mockReturnValue(null);
    await nextHeartbeat();
    expect(documentsOf().kick).toHaveBeenCalledTimes(2);
    leader.handle.stop();
  });
});

describe('a pull settling a document', () => {
  it('the leader says so to the other tabs, and a tab that hears it tells its own panes', async () => {
    const b = browser();
    const leaderStore = { settled: vi.fn() };
    const otherStore = { settled: vi.fn() };
    const leader = b.tab({
      store: leaderStore as unknown as DocumentCrdtStore,
    });
    const other = b.tab({ store: otherStore as unknown as DocumentCrdtStore });
    await flush();
    const documents = startDocumentSync.mock.calls[0]![0] as {
      onSettled?: (id: string) => void;
    };
    documents.onSettled?.('doc_0000000000000001.0000000000');
    await flush();
    expect(otherStore.settled).toHaveBeenCalledWith(
      'doc_0000000000000001.0000000000'
    );
    // Its own panes were told by its own pull.
    expect(leaderStore.settled).not.toHaveBeenCalled();
    leader.handle.stop();
    other.handle.stop();
  });
});

describe('the channel and the cadence', () => {
  it('is down until both channels are up, and down again when either drops', async () => {
    const b = browser();
    const leader = b.tab();
    await flush();
    expect(leader.root.dataset.syncChannel).toBe('down');
    const graph = startGraphSync.mock.calls[0]![0];
    const documents = startDocumentSync.mock.calls[0]![0];
    graph.onChannel?.(true);
    expect(leader.root.dataset.syncChannel).toBe('down');
    graphOf().kick.mockClear();
    documentsOf().kick.mockClear();
    documents.onChannel?.(true);
    expect(leader.root.dataset.syncChannel).toBe('up');
    // Subscribed: catch up now and again five seconds later.
    expect(graphOf().kick).toHaveBeenCalledTimes(1);
    expect(documentsOf().kick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(graphOf().kick).toHaveBeenCalledTimes(2);
    documents.onChannel?.(false);
    expect(leader.root.dataset.syncChannel).toBe('down');
    leader.handle.stop();
    await flush();
    expect(leader.root.dataset.syncChannel).toBeUndefined();
    expect(leader.root.dataset.syncLeader).toBe('0');
  });

  it('while the channel is down, it asks the server every 15 s', async () => {
    const b = browser();
    const leader = b.tab();
    await flush();
    await vi.advanceTimersByTimeAsync(45 * SECOND);
    const probes = clients[0]!.rpc.mock.calls.filter(
      ([fn]) => fn === 'sync_probe'
    );
    expect(probes).toHaveLength(3);
    expect(probes[0]?.[1]).toEqual({ p_space_id: IDENTITY.spaceId });
    leader.handle.stop();
  });

  it('a heartbeat kicks the engine whose kind changed, and sweeps for a deletion', async () => {
    const b = browser();
    const leader = b.tab();
    await flush();
    const rpc = clients[0]!.rpc;
    await vi.advanceTimersByTimeAsync(6 * SECOND);
    graphOf().kick.mockClear();
    documentsOf().kick.mockClear();
    rpc.mockImplementationOnce(async () => ({
      data: [
        {
          epoch: 0,
          graph_changed_at: new Date().toISOString(),
          graph_deleted_at: new Date().toISOString(),
          documents_changed_at: new Date().toISOString(),
          probed_at: new Date().toISOString(),
        },
      ],
      error: null,
    }));
    await vi.advanceTimersByTimeAsync(9 * SECOND);
    expect(graphOf().kick.mock.calls).toEqual([[{ sweep: true }]]);
    expect(documentsOf().kick).toHaveBeenCalledTimes(1);
    leader.handle.stop();
  });

  it('beats presence only while the browser is visible', async () => {
    const b = browser();
    const leader = b.tab({ visible: false });
    await flush();
    const rpc = clients[0]!.rpc;
    await vi.advanceTimersByTimeAsync(300 * SECOND);
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(['sync_probe']);
    leader.setVisible(true);
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    expect(rpc.mock.calls.map(([fn]) => fn)).toContain('sync_presence_beat');
    leader.handle.stop();
  });

  it('another tab being looked at keeps the visible cadence for the hidden leader', async () => {
    const b = browser();
    const leader = b.tab({ visible: false });
    const other = b.tab({ visible: true });
    await flush();
    const rpc = clients[0]!.rpc;
    // The other tab beats every 30 s; the hidden leader keeps asking at the
    // visible (here: channel down, 15 s) cadence, and beats presence.
    await vi.advanceTimersByTimeAsync(61 * SECOND);
    expect(
      rpc.mock.calls.filter(([fn]) => fn === 'sync_probe').length
    ).toBeGreaterThanOrEqual(3);
    expect(rpc.mock.calls.map(([fn]) => fn)).toContain('sync_presence_beat');
    leader.handle.stop();
    other.handle.stop();
  });

  it('a failed heartbeat is reported once per failure, the engines keep running, and recovery catches up', async () => {
    const onHeartbeatFailed = vi.fn();
    const b = browser();
    const leader = b.tab({ onHeartbeatFailed });
    await flush();
    const rpc = clients[0]!.rpc;
    rpc.mockImplementation(async () => ({
      data: null,
      error: { message: 'JWT expired' },
    }));
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    expect(onHeartbeatFailed).toHaveBeenCalledTimes(2);
    expect(String(onHeartbeatFailed.mock.calls[0]?.[0])).toContain(
      'JWT expired'
    );
    expect(graphOf().stop).not.toHaveBeenCalled();
    expect(documentsOf().stop).not.toHaveBeenCalled();

    rpc.mockReset();
    rpc.mockImplementation(async (fn) =>
      fn === 'sync_probe'
        ? {
            data: [
              {
                epoch: 0,
                graph_changed_at: null,
                graph_deleted_at: null,
                documents_changed_at: null,
                probed_at: new Date().toISOString(),
              },
            ],
            error: null,
          }
        : { data: null, error: null }
    );
    graphOf().kick.mockClear();
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    // Nothing changed, but the last look failed: one catch-up, whose push
    // outcome is what withdraws the notice.
    expect(graphOf().kick).toHaveBeenCalledTimes(1);
    expect(onHeartbeatFailed).toHaveBeenCalledTimes(2);
    leader.handle.stop();
  });

  it('another tab turned to asks the leader for a catch-up now and again five seconds later', async () => {
    const b = browser();
    const leader = b.tab();
    const other = b.tab({ visible: false });
    await flush();
    // Channel up: the heartbeat is a minute away.
    const graph = startGraphSync.mock.calls[0]![0];
    const documents = startDocumentSync.mock.calls[0]![0];
    graph.onChannel?.(true);
    documents.onChannel?.(true);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    graphOf().kick.mockClear();
    documentsOf().kick.mockClear();
    other.setVisible(true);
    await flush();
    expect(graphOf().kick).toHaveBeenCalledTimes(1);
    expect(documentsOf().kick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(graphOf().kick).toHaveBeenCalledTimes(2);
    expect(documentsOf().kick).toHaveBeenCalledTimes(2);
    leader.handle.stop();
    other.handle.stop();
  });

  it('every tab says it is visible every 30 s while it is', async () => {
    const b = browser();
    const heard: unknown[] = [];
    const listener = b.bus.open('proflow:sync');
    listener.addEventListener('message', (event) =>
      heard.push((event as MessageEvent).data)
    );
    const other = b.tab({ visible: true });
    await flush();
    expect(heard).toEqual([{ type: 'visible' }]);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(
      heard.filter((m) => (m as { type: string }).type === 'visible')
    ).toHaveLength(3);
    other.setVisible(false);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(
      heard.filter((m) => (m as { type: string }).type === 'visible')
    ).toHaveLength(3);
    other.setVisible(true);
    await flush();
    // Turned to: it says so, and asks the leader to catch up.
    expect(heard.slice(-2)).toEqual([{ type: 'visible' }, { type: 'kick' }]);
    other.handle.stop();
  });
});
