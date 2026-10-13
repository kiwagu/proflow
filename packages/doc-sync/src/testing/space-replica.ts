import { PGlite } from '@electric-sql/pglite';
import {
  createDocumentSync,
  type DocumentSync,
  type SpaceWatchHooks,
} from '../document-sync.js';
import { createPgliteJournal, createPgliteLedger } from '../pglite-ledger.js';
import type { SyncTransport } from '../types.js';
import { LOCAL_SCHEMA, SPACE_ID, TextDocument } from './replica.js';

/**
 * A client replica holding any number of documents of one space — what the
 * space feed is tested against. Same real parts as `createReplica`: its own
 * Loro documents, its own PGlite, the real engine; `blocked` documents are
 * ones the device has no row for yet, which the feed must skip.
 */
export interface SpaceReplica {
  readonly name: string;
  has(docId: string): boolean;
  /** The document's text, or '' for one this replica never opened. */
  text(docId: string): string;
  edit(docId: string, text: string): Promise<void>;
  push(docId: string): ReturnType<DocumentSync['push']>;
  watchSpace(
    hooks?: Omit<SpaceWatchHooks, 'open'>
  ): ReturnType<DocumentSync['watchSpace']>;
  ledger(): ReturnType<typeof createPgliteLedger>;
  headsCursor(): Promise<Date | null>;
  close(): Promise<void>;
}

export async function createSpaceReplica(
  name: string,
  transport: SyncTransport,
  options: {
    pollIntervalMs?: number;
    fullPassIntervalMs?: number;
    blocked?: string[];
  } = {}
): Promise<SpaceReplica> {
  const local = await PGlite.create();
  await local.exec(LOCAL_SCHEMA);
  const ledger = createPgliteLedger(local);
  const sync = createDocumentSync({
    transport,
    ledger,
    journal: createPgliteJournal(local),
    writer: name,
    compaction: false,
    pollIntervalMs: options.pollIntervalMs ?? 25,
    fullPassIntervalMs: options.fullPassIntervalMs,
  });
  const docs = new Map<
    string,
    { document: TextDocument; unsubscribe: () => void }
  >();
  const blocked = new Set(options.blocked ?? []);
  let pending: Array<Promise<unknown>> = [];

  function open(docId: string): TextDocument {
    const held = docs.get(docId);
    if (held) return held.document;
    const document = new TextDocument();
    const unsubscribe = document.doc.subscribeLocalUpdates((bytes) => {
      pending.push(
        local.query(
          'insert into document_update (document_id, bytes) values ($1, $2)',
          [docId, bytes]
        )
      );
    });
    docs.set(docId, { document, unsubscribe });
    return document;
  }
  async function settled() {
    const inflight = pending;
    pending = [];
    await Promise.all(inflight);
  }

  return {
    name,
    has: (docId) => docs.has(docId),
    text: (docId) =>
      docs.get(docId)?.document.doc.getText('body').toString() ?? '',
    async edit(docId, text) {
      const document = open(docId);
      const body = document.doc.getText('body');
      body.insert(body.length, text);
      document.doc.commit({ message: JSON.stringify({ user: name }) });
      await settled();
    },
    push: (docId) => sync.push(docId, open(docId), SPACE_ID),
    watchSpace: (hooks = {}) =>
      sync.watchSpace(SPACE_ID, {
        ...hooks,
        open: async (docId) => (blocked.has(docId) ? null : open(docId)),
      }),
    ledger: () => ledger,
    headsCursor: () => ledger.headsCursor(SPACE_ID),
    async close() {
      for (const held of docs.values()) held.unsubscribe();
      await local.close();
    },
  };
}
