import type {
  DocumentId,
  KnowledgeResourceId,
  SpaceId,
  WriterId,
} from '@workspace/entity-id';
import { MalformedServerRowError } from './server-rows.js';
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

/** Heads per page — one request for a space of ordinary size. */
const HEADS_PAGE = 500;

export interface SpacePassOutcome {
  /** Documents that imported at least one foreign blob in this pass. */
  pulled: number;
  /** Heads the hook could not open: no local row for them yet. */
  skipped: number;
  /** Documents the server sent something for that could not be taken in. */
  refused: number;
}

/**
 * A document the server sent something for that could not be taken in: a
 * malformed head, or a log row whose writer is not a writer id. Nothing of
 * it is applied, so its bytes stay on the server, unread, until the row is
 * corrected — which is why it has to be said, once.
 */
export interface DocumentRefusal {
  /** The document id as the server holds it — possibly the malformed value. */
  documentId: string;
  error: MalformedServerRowError;
}

export interface SpaceWatchHooks {
  /**
   * The local document for a head, or null when this device has no row for
   * it. A null is not an error, and it does not hold the cursor: whoever
   * creates the row later pulls the document then.
   */
  open(docId: DocumentId): Promise<SyncableDocument | null>;
  /** After every pull of the pass that imported at least one foreign blob. */
  onPulled?: (docId: DocumentId, result: PullResult) => void;
  /** A pass completed, whether or not anything was pulled. */
  onPass?: (outcome: SpacePassOutcome) => void;
  /** A failed pass; the next kick simply tries again. */
  onError?: (error: unknown) => void;
}

export interface SpaceWatch {
  stop(): void;
  /**
   * Run a pass now, or once more after the one running. `full` reads every
   * head instead of those past the cursor: a head's time is when its
   * transaction STARTED, so one that waited longer than the overlap window
   * commits below a cursor a faster pass has already taken, and only a
   * full read sees it again.
   */
  kick(opts?: { full?: boolean }): void;
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
  writer: WriterId;
  /** False disables the automatic proposal after push. */
  compaction?: { maxRows?: number; maxBytes?: number } | false;
  /**
   * A document refused (see `DocumentRefusal`): called the first time this
   * engine meets it, never again, however many passes meet it after that.
   */
  onRefused?: (refusal: DocumentRefusal) => void;
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The sync engine: push and pull for one client instance, plus a watch that
 * keeps the documents of a space converged one pass per kick.
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

  /** Server rows this document is known to exist for (ensure is idempotent
   *  but not free — one upsert per process lifetime is enough). */
  const ensured = new Set<DocumentId>();
  /** Local running total of tail bytes seen since the last compaction. */
  const tailByteGauge = new Map<DocumentId, number>();
  /** One pull at a time per document; concurrent requests coalesce. */
  const pullChain = new Map<DocumentId, Promise<PullResult>>();
  /** Documents whose refusal has been reported: once each, not once per pass. */
  const refusedReported = new Set<string>();

  function refuse(documentId: string, error: MalformedServerRowError) {
    if (refusedReported.has(documentId)) return;
    refusedReported.add(documentId);
    options.onRefused?.({ documentId, error });
  }

  async function ensureDocument(
    docId: DocumentId,
    spaceId: SpaceId,
    resourceId: KnowledgeResourceId | null
  ) {
    if (ensured.has(docId)) return;
    await transport.ensureDocument(docId, spaceId, resourceId);
    ensured.add(docId);
  }

  async function maybeCompact(
    docId: DocumentId,
    doc: SyncableDocument
  ): Promise<boolean> {
    const rows = await transport.tailCount(docId);
    const gauge = tailByteGauge.get(docId) ?? 0;
    if (rows < maxRows && gauge < maxBytes) return false;
    // A compaction deletes the rows it folds, so the snapshot must hold every
    // one of them — including rows other writers pushed that this client
    // never pulled, and rows another tab pulled into the shared ledger but
    // not into this copy. Nothing this client records proves that; taking
    // the whole unfolded log in now does, and it is rare enough to afford.
    const whole = await pull(docId, doc, 0);
    if (whole.pulledSeq <= 0) return false;
    const accepted = await transport.compact(
      docId,
      doc.exportSnapshot(),
      whole.pulledSeq
    );
    if (accepted) tailByteGauge.set(docId, 0);
    return accepted;
  }

  async function push(
    docId: DocumentId,
    doc: SyncableDocument,
    spaceId: SpaceId,
    resourceId: KnowledgeResourceId | null = null
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
    await ensureDocument(docId, spaceId, resourceId);
    const seq = await transport.pushUpdate(docId, blob, writer);
    // Only after the insert succeeded — a crash before this line re-sends
    // the same span next time, and every importer no-ops on it.
    await ledger.recordPush(docId, current);
    tailByteGauge.set(docId, (tailByteGauge.get(docId) ?? 0) + blob.length);
    const compacted = await maybeCompact(docId, doc);
    return { pushedSeq: seq, compacted };
  }

  /**
   * `from` overrides the ledger's watermark: 0 takes the whole unfolded log
   * in, whatever the ledger says was pulled.
   */
  async function pullOnce(
    docId: DocumentId,
    doc: SyncableDocument,
    from?: number
  ): Promise<PullResult> {
    const { pushedVv, pulledSeq } = await ledger.read(docId);
    const start = from ?? pulledSeq;
    // The tail before the head. A compaction deletes the rows it folds in
    // the same step as it stores the snapshot holding them: landing before
    // the tail read, it is in the head read after; landing after it, the
    // tail still had every row. The other order would miss both — rows the
    // tail no longer returns, under a head read before they were folded.
    const rows = await transport.tail(docId, start).catch((error: unknown) => {
      // A row this document cannot take in refuses its whole tail — the rows
      // after it build on it — and the watermark stays where it is.
      if (error instanceof MalformedServerRowError) refuse(docId, error);
      throw error;
    });
    const head = await transport.head(docId);
    const incoming: Uint8Array[] = [];
    let floor = start;
    if (head.snapshot && head.snapshotSeq > start) {
      // The snapshot covers everything through snapshotSeq.
      incoming.push(head.snapshot);
      floor = head.snapshotSeq;
    }
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
    // Durability before the watermark: once pulled_seq advances, these
    // bytes are never asked for again, so they must already be able to
    // survive a restart locally. Every import is journaled, even one below
    // the watermark — the document's own journal closes the merge it began.
    if (incoming.length > 0) await journal?.append(docId, incoming);
    if (newSeq > pulledSeq) {
      await ledger.recordPull(docId, newSeq);
      if (settledVv) await ledger.recordPush(docId, settledVv);
    }
    return {
      imported: foreign.length,
      skippedOwn: rows.length - foreign.length,
      pulledSeq: newSeq,
    };
  }

  function pull(
    docId: DocumentId,
    doc: SyncableDocument,
    from?: number
  ): Promise<PullResult> {
    // Serialized per document: two pulls interleaving would race the
    // ledger read against each other's write. Chaining loses nothing —
    // the second pull starts from the watermark the first one advanced.
    const previous = pullChain.get(docId) ?? Promise.resolve(null);
    const next = previous
      .catch(() => null)
      .then(() => pullOnce(docId, doc, from));
    pullChain.set(docId, next as Promise<PullResult>);
    return next;
  }

  async function passSpace(
    spaceId: SpaceId,
    hooks: SpaceWatchHooks,
    full: boolean
  ): Promise<SpacePassOutcome> {
    const since = full ? null : await ledger.headsCursor(spaceId);
    let newest: Date | null = null;
    const due: SyncDocumentHead[] = [];
    let refused = 0;
    for (let offset = 0; ; offset += HEADS_PAGE) {
      const page = await transport.heads(spaceId, since, HEADS_PAGE, offset);
      for (const head of page.rows) {
        if (!newest || head.updatedAt > newest) newest = head.updatedAt;
        const { pulledSeq } = await ledger.read(head.docId);
        if (head.headSeq > pulledSeq) due.push(head);
      }
      // A refused head moves the cursor like any other: left behind it, it
      // would hold the cursor back for every document after it.
      for (const head of page.refused) {
        if (!newest || head.updatedAt > newest) newest = head.updatedAt;
        refuse(head.id, head.error);
        refused += 1;
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
      let result: PullResult;
      try {
        result = await pull(head.docId, doc);
      } catch (error) {
        // Refused for this document alone: the others in the pass go on.
        if (!(error instanceof MalformedServerRowError)) throw error;
        refused += 1;
        continue;
      }
      if (result.imported > 0) {
        pulled += 1;
        hooks.onPulled?.(head.docId, result);
      }
    }
    if (newest) await ledger.advanceHeadsCursor(spaceId, newest);
    return { pulled, skipped, refused };
  }

  /**
   * Keeps every document of a space converged, one pass per kick. The
   * engine keeps no clock and listens to nothing: whoever composes it
   * decides when a pass is worth running and kicks. The first pass of every
   * watch reads every head, so nothing missed in an earlier session waits
   * for a full kick. Passes never overlap: a kick during a pass queues
   * exactly one more, and a full read any of them asked for is kept.
   */
  function watchSpace(spaceId: SpaceId, hooks: SpaceWatchHooks): SpaceWatch {
    let stopped = false;
    let running = false;
    /** The pass asked for while one was running; null when none was. */
    let queued: { full: boolean } | null = null;
    const run = (full: boolean) => {
      running = true;
      passSpace(spaceId, hooks, full)
        .then((outcome) => {
          if (!stopped) hooks.onPass?.(outcome);
        })
        .catch((error: unknown) => {
          if (!stopped) hooks.onError?.(error);
        })
        .finally(() => {
          running = false;
          const next = queued;
          queued = null;
          if (next && !stopped) run(next.full);
        });
    };
    const kick = (opts: { full?: boolean } = {}) => {
      if (stopped) return;
      const full = opts.full === true;
      if (running) {
        queued = { full: (queued?.full ?? false) || full };
        return;
      }
      run(full);
    };
    kick({ full: true });
    return {
      stop() {
        stopped = true;
        queued = null;
      },
      kick,
    };
  }

  return {
    push,
    pull,
    watchSpace,
    /**
     * Explicit compaction proposal — for callers that decide on their own
     * schedule. `coversSeq` must be a seq this client has fully caught up
     * through (its own last pushed row, or its pulled watermark).
     */
    async proposeCompaction(
      docId: DocumentId,
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
