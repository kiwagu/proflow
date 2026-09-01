import { PGlite } from '@electric-sql/pglite';
import { LoroDoc, VersionVector } from 'loro-crdt';
import { toByteaHex } from '../bytea.js';
import { createDocumentSync } from '../document-sync.js';
import { createPgliteJournal, createPgliteLedger } from '../pglite-ledger.js';
import type { SyncableDocument, SyncTransport } from '../types.js';

/**
 * A client replica: its own Loro document, its own local PGlite (snapshot +
 * update journal + sync ledger), and the real engine on top. Nothing here
 * is a mock — a restart really throws the in-memory document away and
 * rebuilds it from the local database, which is the only way the durability
 * ordering (journal before watermark) can actually be tested.
 *
 * The local schema mirrors the shape the persistence package creates; it is
 * spelled out here rather than imported so this harness does not depend on
 * that package's bundler-specific migration loading.
 */
const LOCAL_SCHEMA = `
create table document_snapshot (
  document_id text primary key,
  bytes       bytea not null
);
create table document_update (
  id          bigint generated always as identity primary key,
  document_id text not null,
  bytes       bytea not null
);
create table document_sync (
  document_id text primary key,
  pushed_vv   bytea,
  pulled_seq  bigint not null default 0,
  updated_at  timestamptz not null default now()
);
`;

/** A plain-text Loro document behind the `SyncableDocument` seam. */
class TextDocument implements SyncableDocument {
  doc = new LoroDoc();

  exportUpdatesSince(from: Uint8Array | null): Uint8Array {
    const vv = from ? VersionVector.decode(from) : new VersionVector(null);
    return this.doc.export({ mode: 'update', from: vv });
  }
  versionBytes(): Uint8Array {
    return this.doc.version().encode();
  }
  exportSnapshot(): Uint8Array {
    return this.doc.export({ mode: 'snapshot' });
  }
  importUpdates(updates: Uint8Array[]): void {
    this.doc.importBatch(updates);
  }
}

export const DOC_ID = 'doc_sync_spec_0001';
export const SPACE_ID = 'spc_sync_spec_0001';

export interface Replica {
  readonly name: string;
  text(): string;
  versionHex(): string;
  opCount(): number;
  edit(text: string): Promise<void>;
  push(): ReturnType<ReturnType<typeof createDocumentSync>['push']>;
  pull(): ReturnType<ReturnType<typeof createDocumentSync>['pull']>;
  watch(hooks?: Parameters<ReturnType<typeof createDocumentSync>['watch']>[2]): () => void;
  proposeCompaction(coversSeq: number): Promise<boolean>;
  snapshotLocally(): Promise<void>;
  /** Throws the in-memory document away and rebuilds it from local storage. */
  restart(): Promise<void>;
  ledger(): Promise<{ pushedVv: Uint8Array | null; pulledSeq: number }>;
  journalRowCount(): Promise<number>;
  close(): Promise<void>;
}

export async function createReplica(
  name: string,
  transport: SyncTransport,
  options: { pollIntervalMs?: number } = {}
): Promise<Replica> {
  const local = await PGlite.create();
  await local.exec(LOCAL_SCHEMA);

  const ledger = createPgliteLedger(local);
  const journal = createPgliteJournal(local);
  const sync = createDocumentSync({
    transport,
    ledger,
    journal,
    writer: name,
    // Off by default: every compaction in these tests is proposed explicitly,
    // so the threshold never fires behind a scenario's back.
    compaction: false,
    pollIntervalMs: options.pollIntervalMs ?? 25,
  });

  let document = new TextDocument();
  // Local writes reach the journal the same way the app wires them: through
  // Loro's local-update subscription, not through the sync engine.
  let pending: Array<Promise<unknown>> = [];
  let unsubscribe = subscribeLocal();

  function subscribeLocal() {
    return document.doc.subscribeLocalUpdates((bytes) => {
      pending.push(
        local.query(
          'insert into document_update (document_id, bytes) values ($1, $2)',
          [DOC_ID, bytes]
        )
      );
    });
  }
  async function settled() {
    const inflight = pending;
    pending = [];
    await Promise.all(inflight);
  }

  return {
    name,
    text: () => document.doc.getText('body').toString(),
    versionHex: () => toByteaHex(document.doc.version().encode()),
    opCount: () => document.doc.opCount(),

    async edit(text) {
      const body = document.doc.getText('body');
      body.insert(body.length, text);
      document.doc.commit({ message: JSON.stringify({ user: name }) });
      await settled();
    },

    push: () => sync.push(DOC_ID, document, SPACE_ID),
    pull: () => sync.pull(DOC_ID, document),
    watch: (hooks) => sync.watch(DOC_ID, document, hooks),
    proposeCompaction: (coversSeq) =>
      sync.proposeCompaction(DOC_ID, document, coversSeq),

    async snapshotLocally() {
      await settled();
      const bytes = document.exportSnapshot();
      await local.transaction(async (tx) => {
        await tx.query(
          `insert into document_snapshot (document_id, bytes) values ($1, $2)
           on conflict (document_id) do update set bytes = excluded.bytes`,
          [DOC_ID, bytes]
        );
        await tx.query('delete from document_update where document_id = $1', [
          DOC_ID,
        ]);
      });
    },

    async restart() {
      await settled();
      unsubscribe();
      const snap = await local.query<{ bytes: Uint8Array }>(
        'select bytes from document_snapshot where document_id = $1',
        [DOC_ID]
      );
      const updates = await local.query<{ bytes: Uint8Array }>(
        'select bytes from document_update where document_id = $1 order by id',
        [DOC_ID]
      );
      document = new TextDocument();
      const snapshot = snap.rows[0]?.bytes;
      if (snapshot) document.doc.import(snapshot);
      if (updates.rows.length > 0) {
        document.doc.importBatch(updates.rows.map((r) => r.bytes));
      }
      unsubscribe = subscribeLocal();
    },

    ledger: () => ledger.read(DOC_ID),

    async journalRowCount() {
      await settled();
      const { rows } = await local.query<{ n: number }>(
        'select count(*)::int as n from document_update where document_id = $1',
        [DOC_ID]
      );
      return rows[0]?.n ?? 0;
    },

    async close() {
      unsubscribe();
      await local.close();
    },
  };
}
