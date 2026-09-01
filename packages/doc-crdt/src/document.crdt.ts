import type { EditAuthor } from '@workspace/domain';
import { LoroDoc, VersionVector, type OpId } from 'loro-crdt';
import { readNode, reconcileNode, rootIdOf } from './reconcile.js';
import {
  defaultIdOf,
  type IdOf,
  type SerializedNode,
  type SerializedTree,
} from './tree.js';

/** Root container of the document; the editor tree hangs under `root`. */
const DOC_KEY = 'doc';
const ROOT_KEY = 'root';

/**
 * Who made an edit. Recorded in the commit MESSAGE — deliberately not in the
 * peer id, which is random per instance and so identifies a session rather
 * than a person, and not in `origin`, which is local-only and never travels
 * with the document.
 */
export type CommitAuthor = EditAuthor;

export interface DocumentChange {
  peer: string;
  counter: number;
  lamport: number;
  length: number;
  /** Milliseconds since the epoch (Loro records seconds). */
  at: number;
  author: CommitAuthor | null;
}

export type Frontiers = OpId[];

/**
 * A document, stored as a CRDT.
 *
 * The CRDT is the canonical form even though nothing syncs yet: adopting it
 * later would be a data migration plus a rewrite of the editor integration,
 * whereas adopting it now is only a choice of serialization. What it buys
 * immediately is version history — every commit carries a timestamp and an
 * author, and any past version is addressable by its frontier.
 */
export class DocumentCrdt {
  readonly #doc: LoroDoc;
  readonly #idOf: IdOf;

  private constructor(doc: LoroDoc, idOf: IdOf) {
    // Without this, changes carry no timestamp and no timeline can be built
    // afterwards. It has to be on before the first commit — there is no way
    // to add times to history that was already written.
    doc.setRecordTimestamp(true);
    this.#doc = doc;
    this.#idOf = idOf;
  }

  static create(idOf: IdOf = defaultIdOf): DocumentCrdt {
    return new DocumentCrdt(new LoroDoc(), idOf);
  }

  /**
   * Rebuilds from whatever was stored.
   *
   * Both halves are optional and both matter. A document that has not been
   * snapshotted yet lives entirely in its journal — dropping the journal
   * because there is no snapshot loses everything written so far, and looks
   * exactly like a document that was never written.
   */
  static restore(
    input: { snapshot?: Uint8Array | null; updates?: Uint8Array[] },
    idOf: IdOf = defaultIdOf
  ): DocumentCrdt {
    const doc = new LoroDoc();
    if (input.snapshot) doc.import(input.snapshot);
    if (input.updates?.length) doc.importBatch(input.updates);
    return new DocumentCrdt(doc, idOf);
  }

  /** Rebuilds from a stored snapshot plus any update journal entries. */
  static fromSnapshot(
    snapshot: Uint8Array,
    updates: Uint8Array[] = [],
    idOf: IdOf = defaultIdOf
  ): DocumentCrdt {
    return DocumentCrdt.restore({ snapshot, updates }, idOf);
  }

  /**
   * Reflects the editor tree into the CRDT and commits.
   * Returns whether anything actually changed — an unchanged save must not
   * add an empty entry to the history.
   */
  commitTree(tree: SerializedTree, author: CommitAuthor): boolean {
    const before = this.#doc.opCount();
    const root = this.#doc.getMap(DOC_KEY).ensureMergeableMap(ROOT_KEY);
    reconcileNode(root, tree.root, rootIdOf(tree.root, this.#idOf), this.#idOf);
    this.#doc.setNextCommitOptions({ message: JSON.stringify(author) });
    this.#doc.commit();
    return this.#doc.opCount() > before;
  }

  /** The current tree, or null if the document has never been written. */
  toTree(): SerializedTree | null {
    return readTree(this.#doc);
  }

  /**
   * Full snapshot for storage. Deliberately not a shallow snapshot: shallow
   * discards the operations before its frontier, and with no server copy
   * there would be no history left to travel through.
   */
  exportSnapshot(): Uint8Array {
    return this.#doc.export({ mode: 'snapshot' });
  }

  /**
   * One consolidated blob of everything this document holds beyond `from` —
   * the shape a push sends. `from` is an encoded version vector (what the
   * receiving side last acknowledged), or null for "everything".
   */
  exportUpdatesSince(from: Uint8Array | null): Uint8Array {
    const vv = from ? VersionVector.decode(from) : new VersionVector(null);
    return this.#doc.export({ mode: 'update', from: vv });
  }

  /**
   * The current version vector, encoded for storage. What a sync ledger
   * records as acknowledged after a successful push; the next push exports
   * from here.
   */
  versionBytes(): Uint8Array {
    return this.#doc.version().encode();
  }

  /** Fires for every local change, carrying the bytes to append to the journal. */
  onLocalUpdate(cb: (bytes: Uint8Array) => void): () => void {
    return this.#doc.subscribeLocalUpdates(cb);
  }

  /**
   * Merges updates another writer produced against the same document —
   * another tab, the agent worker. Operations already present (our own
   * journal rows included) merge as no-ops; that idempotence is what lets
   * callers import everything newer than their last look, unfiltered.
   */
  importUpdates(updates: Uint8Array[]): void {
    this.#doc.importBatch(updates);
  }

  /** The current version — what a saved version row points at (~50 bytes). */
  frontiers(): Frontiers {
    return this.#doc.oplogFrontiers();
  }

  opCount(): number {
    return this.#doc.opCount();
  }

  /** History, oldest first, with the author decoded from the commit message. */
  listChanges(): DocumentChange[] {
    const changes: DocumentChange[] = [];
    for (const [peer, peerChanges] of this.#doc.getAllChanges()) {
      for (const change of peerChanges) {
        changes.push({
          peer,
          counter: change.counter,
          lamport: change.lamport,
          length: change.length,
          at: change.timestamp * 1000,
          author: parseAuthor(change.message),
        });
      }
    }
    // Lamport order, not wall-clock: timestamps can tie or skew, and counter
    // is only meaningful within one peer.
    changes.sort((a, b) =>
      a.lamport === b.lamport
        ? a.peer.localeCompare(b.peer)
        : a.lamport - b.lamport
    );
    return changes;
  }

  /**
   * The tree as of a past version, for a read-only preview.
   *
   * Forks rather than checking the live document out, so a preview cannot
   * leave the editable document detached. Returns null when the frontier
   * yields a structurally incomplete tree — a CRDT version is not obliged to
   * be a valid document, so this degrades to "no preview" instead of
   * throwing.
   */
  readAt(frontiers: Frontiers): SerializedTree | null {
    try {
      return readTree(this.#doc.forkAt(frontiers));
    } catch {
      return null;
    }
  }

  /**
   * Restores a past version by appending inverse operations, so the versions
   * that came after it stay in the history. This is the restore primitive;
   * `checkout` only moves a read cursor.
   */
  revertTo(frontiers: Frontiers, author: CommitAuthor): void {
    this.#doc.setNextCommitOptions({ message: JSON.stringify(author) });
    this.#doc.revertTo(frontiers);
    this.#doc.commit();
  }
}

function readTree(doc: LoroDoc): SerializedTree | null {
  const map = doc.getMap(DOC_KEY);
  const root = map.get(ROOT_KEY) as
    { get: (key: string) => unknown } | undefined;
  if (!root || typeof root.get !== 'function') return null;
  const node = readNode(
    root as Parameters<typeof readNode>[0]
  ) as SerializedNode;
  return node.type ? { root: node } : null;
}

function parseAuthor(message: string | undefined): CommitAuthor | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message) as CommitAuthor;
    return typeof parsed?.user === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
