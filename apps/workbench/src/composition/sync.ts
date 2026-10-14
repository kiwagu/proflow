import type { SupabaseClient } from '@supabase/supabase-js';
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
 * Graph replication, as the leader tab of a browser runs it.
 *
 * Where the server lives, which publishable key reaches it and under which
 * cookie the account's session is kept are the server's to say, not the
 * bundle's: they arrive with the session and are kept as a local setting
 * (below). That keeps a checkout of this app from being pinned at build time
 * to one deployment. Whether and when replication runs at all — a stored
 * target, the network, the one tab per browser that holds the lock — is
 * decided by the sync composition, which builds the client and hands it
 * here.
 */

/** The one setting this holds; the server's answer is written back to it verbatim. */
export const SYNC_SETTINGS_KEY = 'sync.supabase';

export interface SyncSettings {
  /** Where the server's API is reached: the backend mount on the gateway origin. */
  url: string;
  /** The publishable (anon) key. Public by design — RLS is the boundary. */
  key: string;
  /**
   * The name of the cookie that holds the account's session. The browser
   * client derives a name from the url it is built with; the platform wrote
   * the session under the name derived from ITS url, so the two differ and
   * this one is what makes the client find the session.
   */
  cookie: string;
}

export interface StartGraphSyncOptions {
  db: AppDb;
  /** The leader's browser client, built from the stored sync target. */
  client: SupabaseClient<Database>;
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
  /** Whether the nudge channel is subscribed: nudges arrive only while it is. */
  onChannel?: (up: boolean) => void;
}

export interface GraphSyncHandle {
  stop(): void;
  /** One cycle (push, then pull); `sweep` adds the inventory sweep. */
  kick(opts?: { sweep?: boolean }): void;
  /** What failed cycles still owe, whoever asked for them (see the engine's `owed`). */
  owed(): { sweep: boolean } | null;
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
    !value.key ||
    // No fallback to a derived name: a setting stored by an older build has
    // none, and the derived one names a cookie that does not exist. It waits
    // for the next session check to rewrite it.
    !('cookie' in value) ||
    typeof value.cookie !== 'string' ||
    !value.cookie
  ) {
    return null;
  }
  return { url: value.url, key: value.key, cookie: value.cookie };
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
 * Replicate the checked-out space over the client the leader built. The
 * engine checks the space out with one sweeping cycle and then runs a cycle
 * per kick: the composition's cadence, a local write, or a nudge from the
 * channel opened here — which is only ever a kick, never a delivery.
 */
export function startGraphSync(
  options: StartGraphSyncOptions
): GraphSyncHandle {
  const { db, client, identity } = options;
  const transport = createSupabaseGraphRowTransport(client);
  const sync = createGraphSync({
    transport,
    replica: replicaOver(db),
    identity: { userId: identity.userId },
    onReconciled: options.onReconciled,
  });
  const watch = sync.watch(identity.spaceId, {
    onPush: (outcome) => {
      if (outcome.stalled) options.onStalled?.();
      else options.onSettled?.();
      if (outcome.accepted > 0) options.onPushed?.(outcome);
    },
    onPull: (outcome) => {
      if (outcome.refused.length > 0) options.onRefused?.(outcome.refused);
      options.onPulled?.(outcome);
    },
    onError: (error: unknown) => options.onError?.(error),
  });
  // A deletion is worth a sweep now: a watermark pull cannot see it.
  const unsubscribe = transport.subscribe(identity.spaceId, {
    onChange: () => watch.kick(),
    onDelete: () => watch.kick({ sweep: true }),
    onStatus: (up) => options.onChannel?.(up),
  });
  return {
    stop() {
      unsubscribe();
      watch.stop();
    },
    kick: (opts) => watch.kick(opts),
    owed: () => watch.owed(),
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
