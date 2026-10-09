import type {
  PullResult,
  PushResult,
  SyncableDocument,
  SyncDocumentHead,
  SyncJournal,
  SyncLedger,
  SyncTransport,
} from './types.js';

/**
 * When a client that has just pushed proposes folding the update log into a
 * fresh snapshot. Row count is exact (one count query per push); the byte
 * gauge is this client's local running total of blob sizes it has seen since
 * the last successful compaction — an approximation that only ever
 * under-counts, which errs toward compacting later, never toward losing
 * anything.
 */
const COMPACTION_MAX_ROWS = 200;
const COMPACTION_MAX_BYTES = 1024 * 1024;

/**
 * How often the watermark is polled while a document is watched. Polling is
 * always on: the realtime subscription is only a nudge and is allowed to
 * drop or lapse silently, so correctness never depends on it. A nudge makes
 * catch-up prompt; the poll makes it inevitable.
 */
const POLL_INTERVAL_MS = 15_000;

/** Heads per page — one request for a space of ordinary size. */
const HEADS_PAGE = 500;

export interface SpacePassOutcome {
  /** Documents that imported at least one foreign blob in this pass. */
  pulled: number;
  /** Heads the hook could not open: no local row for them yet. */
  skipped: number;
}

export interface SpaceWatchHooks {
  /**
   * The local document for a head, or null when this device has no row for
   * it. A null is not an error, and it does not hold the cursor: whoever
   * creates the row later pulls the document then.
   */
  open(docId: string): Promise<SyncableDocument | null>;
  /** After every pull of the pass that imported at least one foreign blob. */
  onPulled?: (docId: string, result: PullResult) => void;
  /** A pass completed, whether or not anything was pulled. */
  onPass?: (outcome: SpacePassOutcome) => void;
  /** A failed pass; the next nudge or poll simply tries again. */
  onError?: (error: unknown) => void;
}

export interface SpaceWatch {
  stop(): void;
  /** Run a pass now. */
  kick(): void;
}

export interface DocumentSyncOptions {
  transport: SyncTransport;
  ledger: SyncLedger;
  /**
   * Where pulled blobs are made locally durable before the pull watermark
   * advances. Omit only where local durability is someone else's problem
   * (tests, one-shot tools) — without it a crash after a pull can strand
   * the watermark past bytes held nowhere locally.
   */
  journal?: SyncJournal;
  /**
   * This client instance's id — every tab and worker mints its own. Used
   * only for echo suppression on pull; author identity travels inside the
   * CRDT bytes.
   */
  writer: string;
  /** False disables the automatic proposal after push. */
  compaction?: { maxRows?: number; maxBytes?: number } | false;
  pollIntervalMs?: number;
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The sync engine: push and pull for one client instance, plus a watch that
 * keeps an open document converged.
 *
 * The protocol has no conflict branch anywhere — the CRDT converges, the
 * server orders rows, and every delivery is at-least-once because importing
 * an operation the document already holds is a no-op.
 */
export function createDocumentSync(options: DocumentSyncOptions) {
  const { transport, ledger, journal, writer } = options;
  const compaction = options.compaction ?? {};
  const maxRows =
    compaction === false
      ? Infinity
      : (compaction.maxRows ?? COMPACTION_MAX_ROWS);
  const maxBytes =
    compaction === false
      ? Infinity
      : (compaction.maxBytes ?? COMPACTION_MAX_BYTES);
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  /** Server rows this document is known to exist for (ensure is idempotent
   *  but not free — one upsert per process lifetime is enough). */
  const ensured = new Set<string>();
  /** Local running total of tail bytes seen since the last compaction. */
  const tailByteGauge = new Map<string, number>();
  /** One pull at a time per document; concurrent requests coalesce. */
  const pullChain = new Map<string, Promise<PullResult>>();

  async function ensureDocument(docId: string, spaceId: string) {
    if (ensured.has(docId)) return;
    await transport.ensureDocument(docId, spaceId);
    ensured.add(docId);
  }

  async function maybeCompact(
    docId: string,
    doc: SyncableDocument,
    coversSeq: number
  ): Promise<boolean> {
    const rows = await transport.tailCount(docId);
    const gauge = tailByteGauge.get(docId) ?? 0;
    if (rows < maxRows && gauge < maxBytes) return false;
    const accepted = await transport.compact(
      docId,
      doc.exportSnapshot(),
      coversSeq
    );
    if (accepted) tailByteGauge.set(docId, 0);
    return accepted;
  }

  async function push(
    docId: string,
    doc: SyncableDocument,
    spaceId: string
  ): Promise<PushResult> {
    const { pushedVv } = await ledger.read(docId);
    const current = doc.versionBytes();
    // Nothing beyond what the server acked: exporting would produce an
    // empty span and pushing it an empty row. Skip by comparing vectors,
    // not blob lengths — the vector is the truth the export runs from.
    if (bytesEqual(pushedVv, current)) {
      return { pushedSeq: null, compacted: false };
    }
    const blob = doc.exportUpdatesSince(pushedVv);
    await ensureDocument(docId, spaceId);
    const seq = await transport.pushUpdate(docId, blob, writer);
    // Only after the insert succeeded — a crash before this line re-sends
    // the same span next time, and every importer no-ops on it.
    await ledger.recordPush(docId, current);
    tailByteGauge.set(docId, (tailByteGauge.get(docId) ?? 0) + blob.length);
    // A client that has just pushed provably holds everything through its
    // own row's seq, which is exactly what a compaction proposal needs.
    const compacted = await maybeCompact(docId, doc, seq);
    return { pushedSeq: seq, compacted };
  }

  async function pullOnce(
    docId: string,
    doc: SyncableDocument
  ): Promise<PullResult> {
    const { pushedVv, pulledSeq } = await ledger.read(docId);
    const head = await transport.head(docId);
    const incoming: Uint8Array[] = [];
    let floor = pulledSeq;
    if (head.snapshot && head.snapshotSeq > pulledSeq) {
      // The snapshot covers everything through snapshotSeq — rows at or
      // below it may already be compacted away, so the tail floor moves up.
      incoming.push(head.snapshot);
      floor = head.snapshotSeq;
    }
    const rows = await transport.tail(docId, floor);
    const foreign = rows.filter((r) => r.writer !== writer);
    incoming.push(...foreign.map((r) => r.bytes));
    /**
     * The version after the import, when everything this replica held
     * before it had already been acknowledged: then the server holds all of
     * it, and recording it as pushed is what keeps the next push from
     * sending pulled operations back. Captured in the same synchronous step
     * as the import, after the document committed what it was still
     * holding, so nothing local can slip in between.
     */
    let settledVv: Uint8Array | null = null;
    if (incoming.length > 0) {
      doc.prepareImport?.();
      const before = doc.versionBytes();
      // Everything in one import: a document that folds a live editor in
      // before merging must do so once, against the state it was edited from.
      doc.importUpdates(incoming);
      if (pushedVv !== null && bytesEqual(pushedVv, before)) {
        settledVv = doc.versionBytes();
      }
      tailByteGauge.set(
        docId,
        (tailByteGauge.get(docId) ?? 0) +
          foreign.reduce((n, r) => n + r.bytes.length, 0)
      );
    }
    const newSeq = Math.max(rows.at(-1)?.seq ?? 0, floor);
    if (newSeq > pulledSeq) {
      // Durability before the watermark: once pulled_seq advances, these
      // bytes are never asked for again, so they must already be able to
      // survive a restart locally.
      if (incoming.length > 0) await journal?.append(docId, incoming);
      await ledger.recordPull(docId, newSeq);
      if (settledVv) await ledger.recordPush(docId, settledVv);
    }
    return {
      imported: foreign.length,
      skippedOwn: rows.length - foreign.length,
      pulledSeq: newSeq,
    };
  }

  function pull(docId: string, doc: SyncableDocument): Promise<PullResult> {
    // Serialized per document: two pulls interleaving would race the
    // ledger read against each other's write. Chaining loses nothing —
    // the second pull starts from the watermark the first one advanced.
    const previous = pullChain.get(docId) ?? Promise.resolve(null);
    const next = previous.catch(() => null).then(() => pullOnce(docId, doc));
    pullChain.set(docId, next as Promise<PullResult>);
    return next;
  }

  /**
   * Keeps an open document converged: an immediate catch-up, a realtime
   * nudge subscription, and a poll that makes progress even when every
   * nudge is lost. Returns the stop function.
   */
  function watch(
    docId: string,
    doc: SyncableDocument,
    hooks: {
      /** After every pull that imported at least one foreign blob. */
      onChange?: (result: PullResult) => void;
      /** A failed pull; the next nudge or poll simply tries again. */
      onError?: (error: unknown) => void;
    } = {}
  ): () => void {
    let stopped = false;
    const kick = () => {
      if (stopped) return;
      pull(docId, doc)
        .then((result) => {
          if (!stopped && result.imported > 0) hooks.onChange?.(result);
        })
        .catch((error: unknown) => {
          if (!stopped) hooks.onError?.(error);
        });
    };
    const unsubscribe = transport.subscribeInserts(docId, kick);
    const timer = setInterval(kick, pollIntervalMs);
    kick();
    return () => {
      stopped = true;
      clearInterval(timer);
      unsubscribe();
    };
  }

  async function passSpace(
    spaceId: string,
    hooks: SpaceWatchHooks
  ): Promise<SpacePassOutcome> {
    const since = await ledger.headsCursor(spaceId);
    let newest: Date | null = null;
    const due: SyncDocumentHead[] = [];
    for (let offset = 0; ; offset += HEADS_PAGE) {
      const page = await transport.heads(spaceId, since, HEADS_PAGE, offset);
      for (const head of page.rows) {
        if (!newest || head.updatedAt > newest) newest = head.updatedAt;
        const { pulledSeq } = await ledger.read(head.docId);
        if (head.headSeq > pulledSeq) due.push(head);
      }
      if (!page.hasMore) break;
    }
    let pulled = 0;
    let skipped = 0;
    for (const head of due) {
      const doc = await hooks.open(head.docId);
      if (!doc) {
        skipped += 1;
        continue;
      }
      const result = await pull(head.docId, doc);
      if (result.imported > 0) {
        pulled += 1;
        hooks.onPulled?.(head.docId, result);
      }
    }
    if (newest) await ledger.advanceHeadsCursor(spaceId, newest);
    return { pulled, skipped };
  }

  /**
   * Keeps every document of a space converged: an immediate pass, a nudge
   * subscription on the space, and the same poll `watch` has. Passes never
   * overlap — a nudge during a pass queues one more.
   */
  function watchSpace(spaceId: string, hooks: SpaceWatchHooks): SpaceWatch {
    let stopped = false;
    let running = false;
    let again = false;
    const run = () => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      passSpace(spaceId, hooks)
        .then((outcome) => {
          if (!stopped) hooks.onPass?.(outcome);
        })
        .catch((error: unknown) => {
          if (!stopped) hooks.onError?.(error);
        })
        .finally(() => {
          running = false;
          if (again) {
            again = false;
            run();
          }
        });
    };
    const unsubscribe = transport.subscribeSpace(spaceId, run);
    const timer = setInterval(run, pollIntervalMs);
    run();
    return {
      stop() {
        stopped = true;
        clearInterval(timer);
        unsubscribe();
      },
      kick: run,
    };
  }

  return {
    push,
    pull,
    watch,
    watchSpace,
    /**
     * Explicit compaction proposal — for callers that decide on their own
     * schedule. `coversSeq` must be a seq this client has fully caught up
     * through (its own last pushed row, or its pulled watermark).
     */
    async proposeCompaction(
      docId: string,
      doc: SyncableDocument,
      coversSeq: number
    ): Promise<boolean> {
      const accepted = await transport.compact(
        docId,
        doc.exportSnapshot(),
        coversSeq
      );
      if (accepted) tailByteGauge.set(docId, 0);
      return accepted;
    },
  };
}

export type DocumentSync = ReturnType<typeof createDocumentSync>;
