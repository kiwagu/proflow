import {
  DocumentCrdt,
  type Frontiers,
  type SerializedTree,
} from '@workspace/doc-crdt';
import type { EditAuthor } from '@workspace/domain';
import type { AppDb } from '../db/db.js';

/**
 * How many journal entries may accumulate before the document is snapshotted
 * and the journal trimmed.
 *
 * Every save appends a small update; replaying them is what makes a crash
 * lose nothing. Snapshotting collapses them so a cold load stays cheap. The
 * number is a trade between write amplification and load time, not a
 * correctness knob — the document reads back the same at any value.
 */
const JOURNAL_LIMIT = 20;

type Open = {
  crdt: DocumentCrdt;
  /** Updates emitted by the current commit, drained after it. */
  pending: Uint8Array[];
  unsubscribe: () => void;
  /** Journal entries written since the last snapshot. */
  journalled: number;
  /** Highest journal row this instance has imported. */
  lastUpdateId: number;
};

/**
 * Documents as CRDTs, on top of the local database.
 *
 * The CRDT is the canonical form: `document_content` beside it is a derived
 * cache that exists so the sidebar and search never have to import a document
 * to read its text. Delete the cache and the document is unharmed; delete the
 * CRDT and its history is gone.
 */
export function createDocumentCrdtStore(db: AppDb) {
  const open = new Map<string, Open>();

  function track(
    id: string,
    crdt: DocumentCrdt,
    journalled: number,
    lastUpdateId: number
  ): Open {
    const entry: Open = {
      crdt,
      pending: [],
      journalled,
      lastUpdateId,
      unsubscribe: () => {},
    };
    entry.unsubscribe = crdt.onLocalUpdate((bytes) =>
      entry.pending.push(bytes)
    );
    open.set(id, entry);
    return entry;
  }

  async function openDocument(id: string): Promise<Open> {
    const cached = open.get(id);
    if (cached) return cached;

    const snapshot = await db.query<{ bytes: Uint8Array }>(
      'select bytes from document_snapshot where document_id = $1',
      [id]
    );
    const updates = await db.query<{ id: number | string; bytes: Uint8Array }>(
      'select id, bytes from document_update where document_id = $1 order by id',
      [id]
    );
    const journal = updates.rows.map((r) => r.bytes);
    const crdt = DocumentCrdt.restore({
      snapshot: snapshot.rows[0]?.bytes,
      updates: journal,
    });
    const last = updates.rows.at(-1);
    return track(id, crdt, journal.length, last ? Number(last.id) : 0);
  }

  /**
   * Brings in journal rows other writers appended since this instance last
   * looked — every tab and the agent worker holds its own copy of the
   * document, over one shared table. Importing our own rows again is a
   * no-op: the CRDT already holds those operations.
   */
  async function importForeign(id: string, entry: Open): Promise<void> {
    const { rows } = await db.query<{ id: number | string; bytes: Uint8Array }>(
      'select id, bytes from document_update where document_id = $1 and id > $2 order by id',
      [id, entry.lastUpdateId]
    );
    if (rows.length === 0) return;
    entry.crdt.importUpdates(rows.map((r) => r.bytes));
    entry.lastUpdateId = Number(rows.at(-1)?.id ?? entry.lastUpdateId);
  }

  async function snapshot(id: string, entry: Open): Promise<void> {
    const bytes = entry.crdt.exportSnapshot();
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into document_snapshot (document_id, bytes, frontiers, op_count, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (document_id) do update
           set bytes = excluded.bytes,
               frontiers = excluded.frontiers,
               op_count = excluded.op_count,
               updated_at = now()`,
        [
          id,
          bytes,
          JSON.stringify(entry.crdt.frontiers()),
          entry.crdt.opCount(),
        ]
      );
      // Only after the snapshot is stored: the journal is what would rebuild
      // the document if this transaction never landed.
      await tx.query('delete from document_update where document_id = $1', [
        id,
      ]);
    });
    entry.journalled = 0;
  }

  return {
    /**
     * Commits the tree and persists it. Returns false when the tree is
     * unchanged — an idle save must not add an entry to the history.
     */
    async save(input: {
      id: string;
      tree: SerializedTree;
      markdown: string;
      preview: string;
      author: EditAuthor;
      writer?: string;
    }): Promise<boolean> {
      const entry = await openDocument(input.id);
      // Converge before committing: the commit's diff must be against
      // everything already written, not this instance's last sight of it.
      await importForeign(input.id, entry);
      const changed = entry.crdt.commitTree(input.tree, input.author);
      const updates = entry.pending.splice(0, entry.pending.length);
      if (!changed) return false;

      await db.transaction(async (tx) => {
        for (const bytes of updates) {
          const { rows } = await tx.query<{ id: number | string }>(
            'insert into document_update (document_id, bytes) values ($1, $2) returning id',
            [input.id, bytes]
          );
          entry.lastUpdateId = Number(rows[0]?.id ?? entry.lastUpdateId);
        }
        await tx.query(
          `insert into document_content (document_id, lexical_json, markdown, writer)
           values ($1, $2, $3, $4)
           on conflict (document_id) do update
             set lexical_json = excluded.lexical_json,
                 markdown = excluded.markdown,
                 writer = excluded.writer,
                 updated_at = now()`,
          [
            input.id,
            JSON.stringify(input.tree),
            input.markdown,
            input.writer ?? null,
          ]
        );
        await tx.query(
          'update document set preview = $2, updated_at = now() where id = $1',
          [input.id, input.preview]
        );
      });

      entry.journalled += updates.length;
      if (entry.journalled >= JOURNAL_LIMIT) await snapshot(input.id, entry);
      return true;
    },

    /** The document's canonical content, rebuilt from the CRDT. */
    async load(id: string): Promise<SerializedTree | null> {
      const entry = await openDocument(id);
      return entry.crdt.toTree();
    },

    frontiers(id: string): Promise<Frontiers> {
      return openDocument(id).then((entry) => entry.crdt.frontiers());
    },

    async readAt(id: string, ref: Frontiers): Promise<SerializedTree | null> {
      const entry = await openDocument(id);
      return entry.crdt.readAt(ref);
    },

    async restore(
      id: string,
      ref: Frontiers,
      author: EditAuthor
    ): Promise<void> {
      const entry = await openDocument(id);
      entry.crdt.revertTo(ref, author);
      const updates = entry.pending.splice(0, entry.pending.length);
      const tree = entry.crdt.toTree();
      await db.transaction(async (tx) => {
        for (const bytes of updates) {
          await tx.query(
            'insert into document_update (document_id, bytes) values ($1, $2)',
            [id, bytes]
          );
        }
        if (tree) {
          await tx.query(
            `insert into document_content (document_id, lexical_json, markdown)
             values ($1, $2, '')
             on conflict (document_id) do update
               set lexical_json = excluded.lexical_json, updated_at = now()`,
            [id, JSON.stringify(tree)]
          );
        }
      });
      entry.journalled += updates.length;
    },

    /** The document's change history, oldest first. */
    async changes(id: string) {
      const entry = await openDocument(id);
      return entry.crdt.listChanges();
    },

    /** Drops the in-memory document; the stored bytes are untouched. */
    close(id: string): void {
      open.get(id)?.unsubscribe();
      open.delete(id);
    },
  };
}

export type DocumentCrdtStore = ReturnType<typeof createDocumentCrdtStore>;
