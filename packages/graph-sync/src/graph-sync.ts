import { planWrites, type PushIdentity } from './push-plan.js';
import {
  GRAPH_SYNC_TABLE_DESCRIPTORS,
  type GraphSyncTableName,
} from './tables.js';
import {
  GraphWriteError,
  type GraphReplica,
  type GraphRowTransport,
  type PullOutcome,
  type PushOutcome,
} from './types.js';

/**
 * Graph row replication: the client half of the projection sync between the
 * server's Postgres and the local PGlite replica.
 *
 * Three mechanics, and the reason there are exactly three:
 *
 *   * PULL by watermark — a cursor over the server's `updated_at`, re-read
 *     with a small overlap so two rows written in the same millisecond, one
 *     of them after the cursor was taken, cannot be skipped forever.
 *   * DISAPPEARANCE by inventory diff — a watermark scan is structurally
 *     blind to a row that VANISHES. Two events do that: a purge (the row is
 *     gone) and an access revocation (the row exists but RLS now hides it).
 *     Neither produces an `updated_at` the client can see, so the sweep
 *     compares the server's id list against the local one and deletes the
 *     difference. One mechanism covers both because locally they are
 *     indistinguishable — and must be, since asking "was it purged or am I
 *     no longer allowed?" is itself an access question.
 *   * PUSH by idempotent replay — the journal drains in order, at-least-once.
 *     A refusal drops the op and every later op touching the same node, then
 *     re-pulls those nodes: the pull IS the rollback, so the failure path is
 *     the ordinary read path rather than a mirrored compensation engine.
 *
 * The authority is the server, always. A local write is a proposal; the
 * replica converges to the server and never the reverse. That is what makes
 * the whole layer conflict-free without vector clocks: there is nothing to
 * merge, only something to accept or refuse.
 */

/** Rows per pull request. Bounded so one catch-up cannot be unbounded work. */
const PULL_PAGE_SIZE = 500;

/** Ops drained per push pass. */
const PUSH_BATCH_SIZE = 100;

/**
 * How often an open space re-polls. Realtime is a nudge and is allowed to
 * lapse silently, so correctness never depends on it: the nudge makes
 * catch-up prompt, the poll makes it inevitable.
 */
const POLL_INTERVAL_MS = 15_000;

export interface GraphSyncOptions {
  transport: GraphRowTransport;
  replica: GraphReplica;
  /** Whose identity the pushed rows carry — the authenticated session's user. */
  identity: PushIdentity;
  pollIntervalMs?: number;
  pullPageSize?: number;
  /** Fired once per reconciliation, for the non-modal "refreshed from server" notice. */
  onReconciled?: (event: { refused: number; nodeIds: string[] }) => void;
}

export function createGraphSync(options: GraphSyncOptions) {
  const { transport, replica, identity } = options;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const pageSize = options.pullPageSize ?? PULL_PAGE_SIZE;

  /** One pull at a time per space; concurrent requests coalesce onto the chain. */
  const pullChain = new Map<string, Promise<PullOutcome>>();
  /** Same for pushes: two drains of one journal would replay the same op twice. */
  const pushChain = new Map<string, Promise<PushOutcome>>();

  async function pullTable(
    spaceId: string,
    table: GraphSyncTableName
  ): Promise<number> {
    let applied = 0;
    // Pages until the server says there are no more: a checkout of a large
    // space is many pages, and stopping at the first would leave the cursor
    // parked mid-history with the rest arriving only by chance.
    for (;;) {
      const since = await replica.cursorFor(spaceId, table);
      const page = await transport.pullSince(table, spaceId, since, pageSize);
      if (page.rows.length === 0) return applied;
      const watermark = await replica.applyPullBatch(table, page.rows);
      applied += page.rows.length;
      if (watermark) await replica.advanceCursor(spaceId, table, watermark);
      if (!page.hasMore) return applied;
      // A full page whose rows all share one timestamp would leave the cursor
      // where it started and loop forever. The overlap window means progress
      // is measured in rows, not in the cursor, so bail to the next pass and
      // let the ordinary catch-up continue rather than spin.
      if (!watermark) return applied;
    }
  }

  async function sweepTable(
    spaceId: string,
    table: GraphSyncTableName,
    force: boolean
  ): Promise<number | null> {
    if (!force && !(await replica.inventoryDue(spaceId, table))) return null;
    const ids = await transport.inventory(table, spaceId);
    return replica.applyInventory(spaceId, table, ids);
  }

  async function pullOnce(
    spaceId: string,
    pass: { sweep?: boolean } = {}
  ): Promise<PullOutcome> {
    let applied = 0;
    let evicted = 0;
    const swept: GraphSyncTableName[] = [];
    for (const descriptor of GRAPH_SYNC_TABLE_DESCRIPTORS) {
      applied += await pullTable(spaceId, descriptor.local);
      const removed = await sweepTable(
        spaceId,
        descriptor.local,
        pass.sweep === true
      );
      if (removed !== null) {
        evicted += removed;
        swept.push(descriptor.local);
      }
    }
    return { applied, evicted, swept };
  }

  function pull(
    spaceId: string,
    opts: { sweep?: boolean } = {}
  ): Promise<PullOutcome> {
    const previous = pullChain.get(spaceId) ?? Promise.resolve(null);
    const next = previous.catch(() => null).then(() => pullOnce(spaceId, opts));
    pullChain.set(spaceId, next as Promise<PullOutcome>);
    return next;
  }

  /**
   * Re-read from the server everything tied to the given nodes, and evict
   * what it did not return. The eviction is the half that matters: a refused
   * create leaves a node the server has never heard of, and re-pulling alone
   * would leave that ghost in the replica forever — it has no server row to
   * overwrite it and no `updated_at` to make it show up in a later scan.
   */
  async function reconcileNodes(
    spaceId: string,
    nodeIds: string[]
  ): Promise<void> {
    if (nodeIds.length === 0) return;
    for (const descriptor of GRAPH_SYNC_TABLE_DESCRIPTORS) {
      if (descriptor.nodeKey === null) continue;
      const held = await replica.rowIdsForNodes(descriptor.local, nodeIds);
      const rows = await transport.pullByNodes(
        descriptor.local,
        spaceId,
        nodeIds
      );
      await replica.applyPullBatch(descriptor.local, rows);
      const returned = new Set(rows.map((row) => row.id));
      const stale = held.filter((id) => !returned.has(id));
      if (stale.length > 0) await replica.deleteRows(descriptor.local, stale);
    }
  }

  async function pushOnce(spaceId: string): Promise<PushOutcome> {
    let accepted = 0;
    let refused = 0;
    const reconciled = new Set<string>();

    for (;;) {
      const ops = await replica.pendingOps(spaceId, PUSH_BATCH_SIZE);
      if (ops.length === 0) break;
      for (const op of ops) {
        try {
          for (const write of planWrites(op, identity)) {
            await transport.write(write);
          }
          await replica.ackOp(op.id);
          accepted += 1;
        } catch (error) {
          if (
            error instanceof GraphWriteError &&
            error.failure === 'unavailable'
          ) {
            // No verdict was ever reached: the op is still a valid proposal
            // and stays queued. Dropping it here would throw away work the
            // user did offline because their network blinked.
            return {
              accepted,
              refused,
              reconciled: [...reconciled],
              stalled: true,
            };
          }
          // A refusal: this op and every later op built on the same node are
          // unreplayable, and the server's rows for those nodes are the truth.
          const affected = await replica.rejectOp(op.id);
          await reconcileNodes(spaceId, affected);
          for (const id of affected) reconciled.add(id);
          refused += 1;
          break;
        }
      }
      // A partially drained batch (a refusal broke out of it) is re-read
      // rather than continued: rejectOp may have removed later ops in the
      // same batch, and replaying a dropped op would resurrect it.
      if (ops.length < PUSH_BATCH_SIZE && refused === 0) break;
    }

    if (refused > 0) {
      options.onReconciled?.({ refused, nodeIds: [...reconciled] });
    }
    return { accepted, refused, reconciled: [...reconciled], stalled: false };
  }

  function push(spaceId: string): Promise<PushOutcome> {
    const previous = pushChain.get(spaceId) ?? Promise.resolve(null);
    const next = previous.catch(() => null).then(() => pushOnce(spaceId));
    pushChain.set(spaceId, next as Promise<PushOutcome>);
    return next;
  }

  /**
   * Keep one checked-out space converged: an immediate catch-up, a nudge
   * subscription, and a poll that makes progress even when every nudge is
   * lost. A deletion nudge sweeps the inventory immediately rather than
   * waiting out the interval — that is the only case where the payload's
   * mere existence tells us something a watermark scan cannot.
   */
  function watch(
    spaceId: string,
    hooks: {
      onPull?: (outcome: PullOutcome) => void;
      onPush?: (outcome: PushOutcome) => void;
      onError?: (error: unknown) => void;
    } = {}
  ): () => void {
    let stopped = false;

    const cycle = (sweep: boolean) => {
      if (stopped) return;
      // Push before pull: a local proposal the server accepts comes back in
      // the same catch-up, so the replica lands on the server's version of
      // the change rather than showing its own optimistic one for a beat.
      push(spaceId)
        .then((outcome) => {
          if (!stopped) hooks.onPush?.(outcome);
          return pull(spaceId, { sweep });
        })
        .then((outcome) => {
          if (!stopped) hooks.onPull?.(outcome);
        })
        .catch((error: unknown) => {
          if (!stopped) hooks.onError?.(error);
        });
    };

    const unsubscribe = transport.subscribe(spaceId, {
      onChange: () => cycle(false),
      onDelete: () => cycle(true),
    });
    const timer = setInterval(() => cycle(false), pollIntervalMs);
    // Checkout: the first pass always sweeps, because a space that was open
    // on another machine may have lost rows while this one was away.
    cycle(true);

    return () => {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
    };
  }

  return {
    pull,
    push,
    watch,
    /** How many local changes are still waiting — the "unsynced" signal. */
    pendingCount: (spaceId: string) => replica.pendingCount(spaceId),
  };
}

export type GraphSync = ReturnType<typeof createGraphSync>;
