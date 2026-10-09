import {
  DocumentCrdt,
  type Frontiers,
  type SerializedTree,
} from '@workspace/doc-crdt';
import type { EditAuthor } from '@workspace/domain';
import type { AppDb } from '../db/db.js';

/**
 * The derived markdown of a tree, rendered by the one headless conversion the
 * agent and the server-side indexer also use — so text this store writes
 * reads back exactly as if the editor had serialized it.
 *
 * The conversion is loaded when a restore asks for it, not when this module
 * is evaluated. Opening the local database goes through this file, and a
 * static import would put the whole editor vocabulary and its headless
 * engine in front of that open: every start-up would wait for text
 * conversion it will most likely never perform. A restore is a deliberate
 * user action with none of that urgency. This is the bundle-splitting case
 * the static-import rule exempts, and it is measured, not assumed — with the
 * static import, the reload in the session acceptance test failed five runs
 * out of six.
 *
 * The tree is structurally an editor state root; the domain type describes
 * the same JSON without depending on the editor library, which is why the
 * shape has to be asserted rather than imported here.
 */
async function treeAsMarkdown(tree: SerializedTree): Promise<string> {
  const { stateToMarkdown } = await import('@workspace/lexical-nodes/utils');
  return stateToMarkdown({ root: tree.root } as Parameters<
    typeof stateToMarkdown
  >[0]);
}

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

/**
 * The open editor, as the store may read it: the tree it holds right now
 * and the author its content is attributed to. Handed in by the
 * composition, which owns the registry the editor announces itself to.
 */
export interface LiveTree {
  read(id: string): SerializedTree | null;
  author: EditAuthor;
}

/** What the document now says, and whose change it was. */
export interface DocumentChanged {
  id: string;
  /** `local`: this instance saved or restored. `remote`: a pull merged in. */
  source: 'local' | 'remote';
  tree: SerializedTree;
  markdown: string;
  /**
   * A remote merge that also carries edits of this device's — the open
   * editor's tree, committed right before the import. Those still have to
   * be sent; nothing else will announce them.
   */
  localEdits?: boolean;
}

/** The document as the sync engine drives it — the CRDT's own methods, structurally. */
export type SyncableCrdt = Pick<
  DocumentCrdt,
  'exportUpdatesSince' | 'versionBytes' | 'exportSnapshot' | 'importUpdates'
> & { prepareImport(): void };

type Open = {
  crdt: DocumentCrdt;
  /** Updates emitted by the current commit, drained after it. */
  pending: Uint8Array[];
  unsubscribe: () => void;
  /** Journal entries written since the last snapshot. */
  journalled: number;
  /** Highest journal row this instance has imported. */
  lastUpdateId: number;
  /** Bumped by every remote merge; a save started before one is stale. */
  generation: number;
  /** A remote merge is between its import and its journal write. */
  merging: boolean;
};

/**
 * Documents as CRDTs, on top of the local database.
 *
 * The CRDT is the canonical form: `document_content` beside it is a derived
 * cache that exists so the sidebar and search never have to import a document
 * to read its text. Delete the cache and the document is unharmed; delete the
 * CRDT and its history is gone.
 */
export function createDocumentCrdtStore(
  db: AppDb,
  options: { live?: LiveTree } = {}
) {
  const open = new Map<string, Open>();
  const live = options.live;
  const listeners = new Set<(event: DocumentChanged) => void>();
  function emit(event: DocumentChanged): void {
    for (const listener of listeners) listener(event);
  }

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
      generation: 0,
      merging: false,
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

  /**
   * Commits what the open editor holds before remote operations merge in.
   *
   * The editor saves whole trees and a save diffs the tree against the
   * CRDT: a stale tree committed AFTER remote operations landed would diff
   * them away. Committed first, against the state it was edited from, it
   * is one more change of this device's, and the remote operations merge
   * on top of it.
   */
  function foldLive(id: string, entry: Open): void {
    const tree = live?.read(id);
    if (!live || !tree) return;
    entry.crdt.commitTree(tree, live.author);
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
      // Read before the first await: a merge that lands while this save
      // waits is what makes the tree it carries stale.
      const seen = open.get(input.id)?.generation ?? 0;
      const entry = await openDocument(input.id);
      // Converge before committing: the commit's diff must be against
      // everything already written, not this instance's last sight of it.
      await importForeign(input.id, entry);
      // A remote merge landed, or is between its import and its journal
      // write: the editor's tree was folded in already, and committing the
      // tree this save carries would diff the remote operations away. A copy
      // dropped meanwhile holds state that never reached the disk.
      if (
        entry.merging ||
        entry.generation !== seen ||
        open.get(input.id) !== entry
      )
        return false;
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
          'update document set preview = $2, version_vv = $3, updated_at = now() where id = $1',
          [input.id, input.preview, entry.crdt.versionBytes()]
        );
      });

      entry.journalled += updates.length;
      if (entry.journalled >= JOURNAL_LIMIT) await snapshot(input.id, entry);
      emit({
        id: input.id,
        source: 'local',
        tree: input.tree,
        markdown: input.markdown,
      });
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
      // Derived before the transaction opens: the conversion loads its own
      // module on first use, and a transaction must never be the thing that
      // waits for a network fetch.
      const markdown = tree ? await treeAsMarkdown(tree) : '';
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
             values ($1, $2, $3)
             on conflict (document_id) do update
               set lexical_json = excluded.lexical_json,
                   markdown = excluded.markdown,
                   updated_at = now()`,
            [id, JSON.stringify(tree), markdown]
          );
        }
        // A restore is an edit like any other: what tells replication this
        // document changed since it was last sent.
        await tx.query(
          'update document set version_vv = $2, updated_at = now() where id = $1',
          [id, entry.crdt.versionBytes()]
        );
      });
      entry.journalled += updates.length;
      if (tree) emit({ id, source: 'local', tree, markdown });
    },

    /** The document's change history, oldest first. */
    async changes(id: string) {
      const entry = await openDocument(id);
      return entry.crdt.listChanges();
    },

    /** Told after every save, restore and remote merge. */
    onChanged(listener: (event: DocumentChanged) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * The document for the sync engine, or null when this device has no
     * row for it (not materialized yet). Rows other writers appended come
     * in first, so a fold diffs against everything already journaled.
     *
     * A merge in flight is left alone: a push opening the document between
     * a pull's import and its journal write must not reopen the window in
     * which a stale save could commit — only the journal write closes it.
     */
    async syncable(id: string): Promise<SyncableCrdt | null> {
      const { rows } = await db.query('select 1 from document where id = $1', [
        id,
      ]);
      if (rows.length === 0) return null;
      const entry = await openDocument(id);
      await importForeign(id, entry);
      return {
        exportUpdatesSince: (from) => entry.crdt.exportUpdatesSince(from),
        versionBytes: () => entry.crdt.versionBytes(),
        exportSnapshot: () => entry.crdt.exportSnapshot(),
        prepareImport: () => foldLive(id, entry),
        importUpdates: (updates) => {
          entry.crdt.importUpdates(updates);
          entry.generation += 1;
          // Set last: the engine follows a successful import with the
          // journal write that clears it.
          entry.merging = true;
        },
      };
    },

    /**
     * The engine's journal: pulled bytes become locally durable here,
     * together with the bytes of the fold that preceded the import, and
     * the derived content follows the merged document.
     */
    syncJournal: {
      append: async (id: string, blobs: Uint8Array[]): Promise<void> => {
        const entry = await openDocument(id);
        try {
          const folded = entry.pending.slice();
          const tree = entry.crdt.toTree();
          // Derived before the transaction opens, as in restore.
          const markdown = tree ? await treeAsMarkdown(tree) : '';
          await db.transaction(async (tx) => {
            for (const bytes of [...folded, ...blobs]) {
              const { rows } = await tx.query<{ id: number | string }>(
                'insert into document_update (document_id, bytes) values ($1, $2) returning id',
                [id, bytes]
              );
              entry.lastUpdateId = Number(rows[0]?.id ?? entry.lastUpdateId);
            }
            if (tree) {
              await tx.query(
                `insert into document_content (document_id, lexical_json, markdown, writer)
                 values ($1, $2, $3, null)
                 on conflict (document_id) do update
                   set lexical_json = excluded.lexical_json,
                       markdown = excluded.markdown,
                       writer = null,
                       updated_at = now()`,
                [id, JSON.stringify(tree), markdown]
              );
              await tx.query('update document set preview = $2 where id = $1', [
                id,
                markdown.slice(0, 200),
              ]);
            }
            await tx.query(
              'update document set version_vv = $2, updated_at = now() where id = $1',
              [id, entry.crdt.versionBytes()]
            );
          });
          entry.pending.splice(0, folded.length);
          entry.journalled += folded.length + blobs.length;
          if (entry.journalled >= JOURNAL_LIMIT) await snapshot(id, entry);
          if (tree) {
            emit({
              id,
              source: 'remote',
              tree,
              markdown,
              localEdits: folded.length > 0,
            });
          }
        } catch (error) {
          // The import changed this copy and nothing of it reached the
          // disk. Kept, it would hold remote operations the editor never
          // saw, and the retried pull would fold the editor's older tree
          // over them. Dropped, the next access rebuilds from the disk and
          // the retry folds and imports again from there.
          entry.unsubscribe();
          if (open.get(id) === entry) open.delete(id);
          throw error;
        } finally {
          entry.merging = false;
        }
      },
    },

    /** Drops the in-memory document; the stored bytes are untouched. */
    close(id: string): void {
      open.get(id)?.unsubscribe();
      open.delete(id);
    },
  };
}

export type DocumentCrdtStore = ReturnType<typeof createDocumentCrdtStore>;
