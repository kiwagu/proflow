import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import type { ISettingsStore } from '@workspace/domain';
import type { SpaceId } from '@workspace/entity-id';
import type {
  AppDb,
  DocumentCrdtStore,
  DocumentPeers,
} from '@workspace/persistence-pglite';
import {
  startDocumentSync,
  type StartDocumentSyncOptions,
} from './document-sync';
import {
  type GraphSyncHandle,
  parseSyncSettings,
  startGraphSync,
  type StartGraphSyncOptions,
  SYNC_SETTINGS_KEY,
} from './sync';
import { createSyncCadence, type SyncCadence } from './sync-cadence';
import { createSyncLeader } from './sync-leader';
import { createSyncPeers } from './sync-peers';
import { createChangeProbe, type ProbeRow } from './sync-probe';

/**
 * Replication of the checked-out space, per browser rather than per tab.
 *
 * One tab of the browser — the one holding the Web Lock named after the
 * user and the space — builds the client, runs both engines and keeps their
 * nudge channels open; it drives them on a cadence of its own (see
 * sync-cadence): a change probe once a minute, a full pass every five, a
 * catch-up whenever the person turns back or the channel comes up. The
 * other tabs build nothing: they say when they are looked at, and hand the
 * leader what they wrote (graph writes here; document writes through the
 * document store's own announcer). When the leader closes, the next tab in
 * line takes over.
 *
 * Starting also needs a stored sync target (the session states it) and the
 * network; neither being met is a working state, not a failure — the editor
 * is local-first, and its changes wait in the journal.
 *
 * `<html data-sync-leader>` says whether this tab is the leader (1/0), and
 * on the leader `data-sync-channel` whether the nudge channel is up or down:
 * a broken edge shows up there rather than as silence.
 */

/** How often a visible tab says so to the leader; the leader keeps it for 45 s. */
export const PEER_VISIBLE_BEAT_MS = 30_000;

type GraphHooks = Omit<
  StartGraphSyncOptions,
  'db' | 'client' | 'identity' | 'onChannel'
>;
type DocumentHooks = Omit<
  StartDocumentSyncOptions,
  'db' | 'client' | 'store' | 'identity' | 'peers' | 'onChannel'
>;

export interface StartSyncOptions {
  db: AppDb;
  settings: ISettingsStore;
  store: DocumentCrdtStore;
  /** The user is the auth user UUID, not an entity id. */
  identity: { userId: string; spaceId: SpaceId };
  /** The document store's announcer: what other tabs wrote to the journal. */
  documentPeers?: DocumentPeers;
  /** Subscribes to this tab's graph writes reaching the journal. */
  onGraphJournaled(listener: () => void): () => void;
  graph?: GraphHooks;
  documents?: DocumentHooks;
  /** A heartbeat (the change probe or the presence beat) failed; the next one retries. */
  onHeartbeatFailed?: (error: unknown) => void;
  /** Web Locks; null means none (no tab syncs). Default: the browser's. */
  locks?: LockManager | null;
  /** The channel the tabs talk over; null means none. Default: a real one. */
  channel?: BroadcastChannel | null;
  /** Where the diagnostics attributes go. Default: `<html>`. */
  root?: HTMLElement;
  /** Whether this tab is looked at, and when that changes. Default: the document. */
  page?: {
    visible(): boolean;
    onVisibilityChange(listener: () => void): () => void;
  };
}

export interface SyncHandle {
  stop(): void;
  /** The stored sync target was rewritten: a tab that could not start may now. */
  settingsChanged(): void;
}

interface Running {
  graph: GraphSyncHandle;
  cadence: SyncCadence;
  catchUp(): void;
  stop(): void;
}

const documentPage = {
  visible: () => document.visibilityState === 'visible',
  onVisibilityChange(listener: () => void) {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export function startSync(options: StartSyncOptions): SyncHandle {
  const { identity } = options;
  const name = `proflow:sync:${identity.userId}:${identity.spaceId}`;
  const root = options.root ?? document.documentElement;
  const page = options.page ?? documentPage;
  const peers = createSyncPeers({ name, channel: options.channel });
  let disposed = false;
  let leader = false;
  /**
   * Set before the settings read, not after the engines are built: two
   * triggers can land in one tick, and two sets of engines would drain one
   * journal twice.
   */
  let starting = false;
  let running: Running | null = null;
  root.dataset.syncLeader = '0';

  const run = (client: SupabaseClient<Database>): Running => {
    const channels = { graph: false, documents: false };
    let cadence: SyncCadence | null = null;
    const channelUp = () => channels.graph && channels.documents;
    const setChannel = (which: keyof typeof channels, up: boolean) => {
      channels[which] = up;
      root.dataset.syncChannel = channelUp() ? 'up' : 'down';
      cadence?.setChannelUp(channelUp());
    };
    root.dataset.syncChannel = 'down';

    const documents = startDocumentSync({
      ...options.documents,
      db: options.db,
      client,
      store: options.store,
      identity,
      peers: options.documentPeers,
      onChannel: (up) => setChannel('documents', up),
      onSettled: (id) => {
        options.documents?.onSettled?.(id);
        peers.announceSettled(id);
      },
    });
    const graph = startGraphSync({
      ...options.graph,
      db: options.db,
      client,
      identity,
      // New nodes may point at bodies this device has no row for yet.
      onPulled: (outcome) => {
        options.graph?.onPulled?.(outcome);
        if (outcome.applied > 0) documents.graphPulled();
      },
      // A node made here is on the server now: its body can be registered.
      onPushed: (outcome) => {
        options.graph?.onPushed?.(outcome);
        documents.graphPushed();
      },
      onChannel: (up) => setChannel('graph', up),
    });

    const catchUp = () => {
      graph.kick();
      documents.kick();
    };
    const probe = createChangeProbe({
      probe: async (spaceId) => {
        const { data, error } = await client.rpc('sync_probe', {
          p_space_id: spaceId,
        });
        if (error) throw new Error(`change probe failed: ${error.message}`);
        const row = (data as ProbeRow[] | null)?.[0];
        if (!row) throw new Error('change probe failed: no answer');
        return row;
      },
      beat: async (spaceId) => {
        const { error } = await client.rpc('sync_presence_beat', {
          p_space_id: spaceId,
        });
        if (error) throw new Error(`presence beat failed: ${error.message}`);
      },
      startedAt: Date.now(),
    });
    /** The last heartbeat failed: the next one that does not catches up. */
    let failed = false;
    cadence = createSyncCadence(
      {
        now: () => Date.now(),
        setTimeout: (run, ms) => window.setTimeout(run, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      {
        heartbeat: async ({ visible }) => {
          try {
            const changed = await probe.heartbeat(identity.spaceId, {
              visible,
            });
            // Recovered from a failed look: one pass of each, whose push
            // outcome is what withdraws the notice the failure left.
            const recovering = failed;
            failed = false;
            // What a failed pass still owes is asked for again whatever the
            // probe says: the probe has already moved past the change that
            // pass was for, and would not ask again before the full pass.
            // The engines keep the account themselves — whoever asked (this
            // heartbeat, a nudge, their own first pass) — so a sweep or a
            // full read stays owed until one of its kind goes through.
            const graphOwed = graph.owed();
            const documentsOwed = documents.owed();
            if (changed.graphDelete || graphOwed?.sweep)
              graph.kick({ sweep: true });
            else if (changed.graph || graphOwed || recovering) graph.kick();
            if (documentsOwed?.full) documents.kick({ full: true });
            else if (changed.documents || documentsOwed || recovering)
              documents.kick();
          } catch (error) {
            failed = true;
            options.onHeartbeatFailed?.(error);
            throw error;
          }
        },
        fullPass: () => {
          graph.kick({ sweep: true });
          documents.kick({ full: true });
        },
        catchUp,
      },
      { visible: page.visible(), channelUp: channelUp() }
    );
    cadence.start();
    const started = cadence;
    return {
      graph,
      cadence: started,
      catchUp,
      stop() {
        started.stop();
        graph.stop();
        documents.stop();
        delete root.dataset.syncChannel;
      },
    };
  };

  const begin = () => {
    if (disposed || !leader || running || starting || !navigator.onLine) return;
    starting = true;
    void (async () => {
      try {
        const stored = await options.settings.get(SYNC_SETTINGS_KEY);
        const config = stored.isOk() ? parseSyncSettings(stored.value) : null;
        // Never configured, or configured by an older build without the
        // cookie name: nothing to replicate to yet. The next session check
        // rewrites the setting and says so.
        if (!config || disposed || !leader) return;
        // The browser client reads the account cookies itself: they are set
        // on the gateway origin at the root path — under the name the server
        // stated, not the one this url would derive.
        const client = createBrowserClient<Database>(config.url, config.key, {
          cookieOptions: { name: config.cookie },
        });
        running = run(client);
      } catch (error) {
        // Building failed — an unusable stored configuration is the likely
        // cause. The flag below is released either way, so the next network
        // change or session check tries again.
        options.graph?.onError?.(error);
      } finally {
        starting = false;
      }
    })();
  };

  const leadership = createSyncLeader({
    name,
    locks: options.locks,
    onAcquire: () => {
      leader = true;
      root.dataset.syncLeader = '1';
      begin();
      return () => {
        leader = false;
        root.dataset.syncLeader = '0';
        running?.stop();
        running = null;
      };
    },
  });

  // A graph write here: the leader pushes it, whichever tab that is.
  const offJournal = options.onGraphJournaled(() => {
    if (running) running.graph.kick();
    else if (!leader) peers.announceGraphJournal();
  });
  const offPeers = peers.on((message) => {
    // Every tab, leader or not: a pane here may be waiting on the pull the
    // leader just finished.
    if (message.type === 'settled') {
      options.store.settled(message.id);
      return;
    }
    if (!running) return;
    if (message.type === 'graph-journal') running.graph.kick();
    else if (message.type === 'visible') running.cadence.peerVisible();
    // Another tab was turned to: the same catch-up, echo included, as when
    // this one is.
    else running.cadence.catchUpNow();
  });

  // Every tab says when it is looked at; only the leader listens.
  const beatVisible = () => {
    if (page.visible()) peers.announceVisible();
  };
  beatVisible();
  const visibleBeat = window.setInterval(beatVisible, PEER_VISIBLE_BEAT_MS);
  const offVisibility = page.onVisibilityChange(() => {
    const visible = page.visible();
    if (visible) {
      peers.announceVisible();
      peers.announceKick();
    }
    running?.cadence.setVisible(visible);
  });

  const onOnline = () => {
    if (running) running.catchUp();
    else begin();
  };
  window.addEventListener('online', onOnline);

  return {
    stop() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('online', onOnline);
      window.clearInterval(visibleBeat);
      offVisibility();
      offPeers();
      offJournal();
      leadership.stop();
      peers.close();
    },
    settingsChanged: begin,
  };
}
