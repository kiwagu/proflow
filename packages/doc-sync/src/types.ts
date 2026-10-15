import type {
  DocumentId,
  KnowledgeResourceId,
  SpaceId,
  WriterId,
} from '@workspace/entity-id';
import type { RefusedHead } from './server-rows.js';

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
   *
   * Called at most ONCE per pull, with everything the pull brings, and a
   * call that returns is always followed by `SyncJournal.append` for the
   * same blobs.
   */
  importUpdates(updates: Uint8Array[]): void;
  /**
   * Called once per pull immediately before `importUpdates`, in the same
   * synchronous step. A document that holds edits not committed yet (an
   * open editor's tree) commits them here, so they are part of the version
   * the engine compares against what it has pushed — never mistaken for
   * part of what it pulled.
   */
  prepareImport?(): void;
}

export interface SyncHead {
  snapshot: Uint8Array | null;
  snapshotSeq: number;
}

/** One document's place in the space feed: how far its log goes and when it last moved. */
export interface SyncDocumentHead {
  docId: DocumentId;
  headSeq: number;
  updatedAt: Date;
}

export interface SyncHeadsPage {
  rows: SyncDocumentHead[];
  /** Heads of the page that were refused, each on its own. */
  refused: RefusedHead[];
  hasMore: boolean;
}

export interface SyncTailRow {
  seq: number;
  bytes: Uint8Array;
  /** Client instance id of whoever pushed the row — echo suppression only. */
  writer: WriterId;
}

/**
 * The server, as the engine sees it: an append-only update log with a
 * watermark, a snapshot head, and one guarded destructive operation.
 */
export interface SyncTransport {
  /**
   * Makes sure the server has the document row (idempotent). A row that
   * exists is left as it is. Otherwise `resourceId` names the resource that
   * owns the body; it is written once, here, and only accepted from someone
   * who could edit that resource — the server fences the body through it.
   * Null means the owner is not known on this device: no row is created, and
   * the call rejects with `DocumentNotRegisteredError`.
   */
  ensureDocument(
    docId: DocumentId,
    spaceId: SpaceId,
    resourceId?: KnowledgeResourceId | null
  ): Promise<void>;
  /** The latest server snapshot and the watermark folded into it. */
  head(docId: DocumentId): Promise<SyncHead>;
  /** Update rows with seq > afterSeq, in seq order — the catch-up tail. */
  tail(docId: DocumentId, afterSeq: number): Promise<SyncTailRow[]>;
  /** Appends one consolidated update blob; resolves to its server seq. */
  pushUpdate(
    docId: DocumentId,
    bytes: Uint8Array,
    writer: WriterId
  ): Promise<number>;
  /** How many update rows the document currently has (compaction gauge). */
  tailCount(docId: DocumentId): Promise<number>;
  /**
   * Proposes folding the log through coversSeq into the given full snapshot.
   * False means a concurrent compaction already covered more (a no-op, not
   * an error).
   */
  compact(
    docId: DocumentId,
    snapshot: Uint8Array,
    coversSeq: number
  ): Promise<boolean>;
  /**
   * Heads of the space's documents changed at or after `since` (null = all
   * of them), oldest first with the id as tiebreaker, `limit` at a time
   * from `offset`. At-least-once like everything else here: the caller
   * re-reads an overlap window below its cursor, and a head it already
   * holds costs one ledger read.
   */
  heads(
    spaceId: SpaceId,
    since: Date | null,
    limit: number,
    offset: number
  ): Promise<SyncHeadsPage>;
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
    documentId: DocumentId
  ): Promise<{ pushedVv: Uint8Array | null; pulledSeq: number }>;
  recordPush(documentId: DocumentId, pushedVv: Uint8Array): Promise<void>;
  /** Only ever advances — a stale write must not move the watermark back. */
  recordPull(documentId: DocumentId, pulledSeq: number): Promise<void>;
  /**
   * The space feed cursor, already backed off by the overlap window; null
   * when the space was never read (a checkout — read every head).
   */
  headsCursor(spaceId: SpaceId): Promise<Date | null>;
  /** Only ever advances. */
  advanceHeadsCursor(spaceId: SpaceId, cursor: Date): Promise<void>;
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
  append(documentId: DocumentId, blobs: Uint8Array[]): Promise<void>;
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
