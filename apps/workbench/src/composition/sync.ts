import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@workspace/db';
import type { ISettingsStore } from '@workspace/domain';
import type { KnowledgeResourceId, SpaceId } from '@workspace/entity-id';
import {
  createGraphSync,
  createSupabaseGraphRowTransport,
  type GraphReplica,
  type RefusedServerRow,
} from '@workspace/graph-sync';
import {
  createPgliteGraphReplicaWriter,
  createPgliteGraphSyncLedger,
  type AppDb,
} from '@workspace/persistence-pglite';

/**
 * Replication, started only when it can actually run.
 *
 * Where the server lives and which publishable key reaches it are the
 * server's to say, not the bundle's: they arrive with the session and are
 * kept as a local setting. That is what keeps a checkout of this app from
 * being pinned at build time to one deployment — and it is why replication
 * is conditional rather than part of opening the app.
 *
 * Two conditions, both necessary: a configuration has been received at
 * least once, and the device is on the network. Neither being met is a
 * WORKING state, not a failure — the editor is local-first, so an app that
 * has never been online is a complete editor whose changes are waiting in
 * the journal. The moment the network returns, the queue drains.
 */

/** The one setting this holds; the server's answer is written back to it verbatim. */
export const SYNC_SETTINGS_KEY = 'sync.supabase';

export interface SyncSettings {
  /** The server's API origin. */
  url: string;
  /** The publishable (anon) key. Public by design — RLS is the boundary. */
  key: string;
}

export interface StartGraphSyncOptions {
  db: AppDb;
  settings: ISettingsStore;
  /**
   * The server-verified session and the space currently checked out. The
   * user is the auth user UUID, not an entity id.
   */
  identity: { userId: string; spaceId: SpaceId };
  /** Fired when the server refused a local change and the replica was re-read. */
  onReconciled?: (event: {
    refused: number;
    nodeIds: KnowledgeResourceId[];
  }) => void;
  onError?: (error: unknown) => void;
  /**
   * A push completed: whatever was reported failing is now through. Only a
   * push says so — a pull succeeding while writes cannot reach the server
   * is not recovery.
   */
  onSettled?: () => void;
  /** A push found the server unreachable: local changes are waiting. */
  onStalled?: () => void;
  /** A pull applied rows: a consumer that derives from them may run now. */
  onPulled?: (outcome: { applied: number }) => void;
  /**
   * Rows the server sent that could not be taken in — a malformed id. They
   * were left out and the rest applied; each is handed over once.
   */
  onRefused?: (rows: RefusedServerRow[]) => void;
  /** A push got changes accepted: a consumer that waited for them may run now. */
  onPushed?: (outcome: { accepted: number }) => void;
}

export function parseSyncSettings(raw: string | null): SyncSettings | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('url' in value) ||
    typeof value.url !== 'string' ||
    !value.url ||
    !('key' in value) ||
    typeof value.key !== 'string' ||
    !value.key
  ) {
    return null;
  }
  return { url: value.url, key: value.key };
}

/**
 * Keep what the server just said. Every online session check calls this, so
 * a key rotated on the server reaches the device on its next check — there
 * is no separate rotation path because there does not need to be one.
 */
export async function rememberSyncSettings(
  settings: ISettingsStore,
  value: SyncSettings
): Promise<void> {
  await settings.set(SYNC_SETTINGS_KEY, JSON.stringify(value));
}

/**
 * Start replicating the checked-out space, or arrange to start once that
 * becomes possible. Returns the disposer: one page owns one watch, and a
 * change of user or space reloads the page, so there is never a second.
 */
export function startGraphSync(options: StartGraphSyncOptions): () => void {
  const { db, settings, identity } = options;
  let disposed = false;
  /**
   * Set BEFORE the settings read, not after the engine is built: the two
   * triggers below can fire in the same tick, and a flag set after an await
   * would let both of them past it. Two engines would drain one journal
   * twice.
   */
  let starting = false;
  let stopWatch: (() => void) | null = null;

  const begin = () => {
    if (disposed || starting || !navigator.onLine) return;
    starting = true;
    void (async () => {
      try {
        const stored = await settings.get(SYNC_SETTINGS_KEY);
        const config = stored.isOk() ? parseSyncSettings(stored.value) : null;
        if (!config) {
          // Never configured (or unreadable): nothing to replicate to. The app
          // keeps working locally and this is retried when the network changes.
          starting = false;
          return;
        }
        if (disposed) return;
        // The browser client reads the account cookies itself: they are set on
        // the gateway origin at the root path, so a page under this mount
        // carries the same session the server verified.
        const client = createBrowserClient<Database>(config.url, config.key);
        const sync = createGraphSync({
          transport: createSupabaseGraphRowTransport(client),
          replica: replicaOver(db),
          identity: { userId: identity.userId },
          onReconciled: options.onReconciled,
        });
        const stop = sync.watch(identity.spaceId, {
          onPush: (outcome) => {
            if (outcome.stalled) options.onStalled?.();
            else options.onSettled?.();
            if (outcome.accepted > 0) options.onPushed?.(outcome);
          },
          onPull: (outcome) => {
            if (outcome.refused.length > 0)
              options.onRefused?.(outcome.refused);
            options.onPulled?.(outcome);
          },
          onError: (error: unknown) => options.onError?.(error),
        });
        // Disposal may have landed while the settings read was in flight.
        if (disposed) {
          stop();
          return;
        }
        stopWatch = stop;
      } catch (error) {
        // Building the engine failed — an unusable stored configuration is
        // the likely cause. Releasing the flag is the point: without it the
        // attempt would be the last one this page ever makes, and a local
        // editor whose queue silently stopped draining is worse than one
        // that retries when the network next changes.
        starting = false;
        options.onError?.(error);
      }
    })();
  };

  const onOnline = () => begin();
  window.addEventListener('online', onOnline);
  begin();

  return () => {
    disposed = true;
    window.removeEventListener('online', onOnline);
    stopWatch?.();
    stopWatch = null;
  };
}

/**
 * The local half of replication: the ledger's cursors and op journal, and
 * the replica writer, over the one database this page owns. The engine's
 * port is satisfied structurally so the sync package never depends on the
 * persistence package at runtime.
 */
function replicaOver(db: AppDb): GraphReplica {
  const ledger = createPgliteGraphSyncLedger(db);
  const writer = createPgliteGraphReplicaWriter(db);
  return {
    cursorFor: (space, table) => ledger.cursorFor(space, table),
    advanceCursor: (space, table, cursor) =>
      ledger.advanceCursor(space, table, cursor),
    inventoryDue: (space, table, now) => ledger.inventoryDue(space, table, now),
    applyInventory: (space, table, ids) =>
      ledger.applyInventory(space, table, ids),
    applyPullBatch: (table, rows) => writer.applyPullBatch(table, rows),
    deleteRows: (table, ids) => writer.deleteRows(table, ids),
    rowIdsForNodes: (table, nodeIds) => writer.rowIdsForNodes(table, nodeIds),
    pendingOps: (space, limit) => ledger.pendingOps(space, limit),
    ackOp: (opId) => ledger.ackOp(opId),
    rejectOp: (opId) => ledger.rejectOp(opId),
    pendingCount: (space) => ledger.pendingCount(space),
  };
}
