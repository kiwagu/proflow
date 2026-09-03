/**
 * The seams of the sync layer, as interfaces.
 *
 * The engine (document-sync.ts) is written entirely against these: what a
 * document must be able to do, where the per-document ledger lives, and what
 * the server looks like. The production wiring is a Supabase client behind
 * `SyncTransport` and the local PGlite behind `SyncLedger`/`SyncJournal`;
 * tests wire an embedded PGlite behind the same transport interface, so the
 * protocol is exercised for real while auth stays out of the picture.
 */

/**
 * What the engine needs from a document. Structurally satisfied by
 * `DocumentCrdt` — the interface exists so this package does not
 * depend on the CRDT package at runtime.
 */
export interface SyncableDocument {
  /**
   * One consolidated blob of everything beyond `from` (an encoded version
   * vector, or null for "everything") — the unit a push sends.
   */
  exportUpdatesSince(from: Uint8Array | null): Uint8Array;
  /** The current version vector, encoded — advances the ledger after a push. */
  versionBytes(): Uint8Array;
  /** Full snapshot (never shallow) — what a compaction proposal uploads. */
  exportSnapshot(): Uint8Array;
  /**
   * Merges pulled blobs. Operations already present no-op, which is what
   * makes at-least-once delivery safe. Accepts snapshot blobs too.
   */
  importUpdates(updates: Uint8Array[]): void;
}

export interface SyncHead {
  snapshot: Uint8Array | null;
  snapshotSeq: number;
}

export interface SyncTailRow {
  seq: number;
  bytes: Uint8Array;
  /** Client instance id of whoever pushed the row — echo suppression only. */
  writer: string;
}

/**
 * The server, as the engine sees it: an append-only update log with a
 * watermark, a snapshot head, and one guarded destructive operation.
 */
export interface SyncTransport {
  /** Creates the server document row if it does not exist yet (idempotent). */
  ensureDocument(docId: string, spaceId: string): Promise<void>;
  /** The latest server snapshot and the watermark folded into it. */
  head(docId: string): Promise<SyncHead>;
  /** Update rows with seq > afterSeq, in seq order — the catch-up tail. */
  tail(docId: string, afterSeq: number): Promise<SyncTailRow[]>;
  /** Appends one consolidated update blob; resolves to its server seq. */
  pushUpdate(docId: string, bytes: Uint8Array, writer: string): Promise<number>;
  /** How many update rows the document currently has (compaction gauge). */
  tailCount(docId: string): Promise<number>;
  /**
   * Proposes folding the log through coversSeq into the given full snapshot.
   * False means a concurrent compaction already covered more (a no-op, not
   * an error).
   */
  compact(
    docId: string,
    snapshot: Uint8Array,
    coversSeq: number
  ): Promise<boolean>;
  /**
   * A nudge — nothing more — that new rows may exist. Delivery is not
   * trusted: every nudge triggers the same watermark query a poll would.
   */
  subscribeInserts(docId: string, onNudge: () => void): () => void;
}

/**
 * The per-document sync ledger (locally durable):
 * - `pushedVv` — version vector the server has acknowledged. Advanced only
 *   after an insert succeeds; a crash in between re-sends the same span,
 *   which importers no-op on.
 * - `pulledSeq` — the server watermark this replica has caught up to and
 *   made locally durable.
 */
export interface SyncLedger {
  read(
    documentId: string
  ): Promise<{ pushedVv: Uint8Array | null; pulledSeq: number }>;
  recordPush(documentId: string, pushedVv: Uint8Array): Promise<void>;
  /** Only ever advances — a stale write must not move the watermark back. */
  recordPull(documentId: string, pulledSeq: number): Promise<void>;
}

/**
 * Where pulled blobs become locally durable before the pull watermark
 * advances. Wired to the local update journal: a restart then rebuilds the
 * document from local storage alone, and the server is never asked twice
 * for bytes already held. Without this ordering a crash after `recordPull`
 * would leave the watermark past bytes that exist nowhere locally — a
 * permanent hole.
 */
export interface SyncJournal {
  append(documentId: string, blobs: Uint8Array[]): Promise<void>;
}

export interface PushResult {
  /** Null when the ledger already covered everything (nothing was sent). */
  pushedSeq: number | null;
  /** True when this push also proposed a compaction and the server took it. */
  compacted: boolean;
}

export interface PullResult {
  imported: number;
  skippedOwn: number;
  pulledSeq: number;
}
