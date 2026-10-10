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

/**
 * The other tabs of this browser, which share the local database but each
 * hold their own copy of an open document. A tab announces a document after
 * writing to its journal; the others merge what it wrote. Only a hint —
 * whatever a tab merges, it reads from the database.
 */
export interface DocumentPeers {
  announce(id: string): void;
  listen(onAnnounce: (id: string) => void): () => void;
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
  /**
   * Every journal row up to here is in this copy. Moved only by reading the
   * journal — never by this copy's own writes, which would step over rows
   * another tab wrote in between.
   */
  lastUpdateId: number;
  /** Rows this copy wrote that a read has not passed yet. */
  own: Set<number>;
  /** The stored snapshot this copy holds, by its write time. */
  snapshotStamp: string | null;
  /** Another tab announced a write while a merge was running here. */
  mergeAgain: boolean;
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
  options: { live?: LiveTree; peers?: DocumentPeers } = {}
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
    lastUpdateId: number,
    snapshotStamp: string | null
  ): Open {
    const entry: Open = {
      crdt,
      pending: [],
      journalled,
      lastUpdateId,
      own: new Set(),
      snapshotStamp,
      mergeAgain: false,
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

  /**
   * Opens in progress, one per document. Two callers opening the same
   * document at once — a catch-up push and the editor's first save — must
   * get the same copy: two copies would each hold half of what is written,
   * and the one the map dropped would refuse its save.
   */
  const opening = new Map<string, Promise<Open>>();

  function openDocument(id: string): Promise<Open> {
    const cached = open.get(id);
    if (cached) return Promise.resolve(cached);
    const pending = opening.get(id);
    if (pending) return pending;
    const started = readDocument(id).finally(() => opening.delete(id));
    opening.set(id, started);
    return started;
  }

  async function readDocument(id: string): Promise<Open> {
    const snapshot = await db.query<{ bytes: Uint8Array; stamp: string }>(
      'select bytes, updated_at::text as stamp from document_snapshot where document_id = $1',
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
    // A document written before its version was kept beside the row gets
    // it now: replication finds the documents it still has to send by it.
    await db.query(
      'update document set version_vv = $2 where id = $1 and version_vv is null',
      [id, crdt.versionBytes()]
    );
    const last = updates.rows.at(-1);
    return track(
      id,
      crdt,
      journal.length,
      last ? Number(last.id) : 0,
      snapshot.rows[0]?.stamp ?? null
    );
  }

  type JournalRead = {
    blobs: Uint8Array[];
    last: number;
    stamp: string | null;
  };

  /**
   * What other writers put in the journal since this copy last looked —
   * every tab holds its own copy over one shared table — and the stored
   * snapshot when another tab replaced it: a snapshot folds journal rows
   * away, including ones this copy never read.
   */
  async function readJournal(id: string, entry: Open): Promise<JournalRead> {
    const { rows } = await db.query<{ id: number | string; bytes: Uint8Array }>(
      'select id, bytes from document_update where document_id = $1 and id > $2 order by id',
      [id, entry.lastUpdateId]
    );
    const stored = await db.query<{ stamp: string }>(
      'select updated_at::text as stamp from document_snapshot where document_id = $1',
      [id]
    );
    const stamp = stored.rows[0]?.stamp ?? null;
    const blobs: Uint8Array[] = [];
    if (stamp !== null && stamp !== entry.snapshotStamp) {
      const { rows: snap } = await db.query<{ bytes: Uint8Array }>(
        'select bytes from document_snapshot where document_id = $1',
        [id]
      );
      if (snap[0]) blobs.push(snap[0].bytes);
    }
    for (const row of rows) {
      if (!entry.own.has(Number(row.id))) blobs.push(row.bytes);
    }
    const last = Number(rows.at(-1)?.id ?? entry.lastUpdateId);
    return { blobs, last, stamp };
  }

  /** Takes what was read into the copy; true when that changed the document. */
  function applyJournal(entry: Open, read: JournalRead): boolean {
    const before = entry.crdt.versionBytes();
    if (read.blobs.length > 0) entry.crdt.importUpdates(read.blobs);
    entry.lastUpdateId = Math.max(entry.lastUpdateId, read.last);
    for (const rowId of entry.own) {
      if (rowId <= entry.lastUpdateId) entry.own.delete(rowId);
    }
    entry.snapshotStamp = read.stamp;
    const after = entry.crdt.versionBytes();
    return (
      before.length !== after.length || before.some((b, i) => b !== after[i])
    );
  }

  /** A copy whose writes failed holds state the disk does not: forget it. */
  function drop(id: string, entry: Open): void {
    entry.unsubscribe();
    if (open.get(id) === entry) open.delete(id);
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
    const stamp = await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ stamp: string }>(
        `insert into document_snapshot (document_id, bytes, frontiers, op_count, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (document_id) do update
           set bytes = excluded.bytes,
               frontiers = excluded.frontiers,
               op_count = excluded.op_count,
               updated_at = now()
         returning updated_at::text as stamp`,
        [
          id,
          bytes,
          JSON.stringify(entry.crdt.frontiers()),
          entry.crdt.opCount(),
        ]
      );
      // Only after the snapshot is stored: the journal is what would rebuild
      // the document if this transaction never landed. And only rows this
      // copy holds: another tab's rows it has not read stay for that tab's
      // writes to reach everyone.
      await tx.query(
        'delete from document_update where document_id = $1 and (id <= $2 or id = any($3::bigint[]))',
        [id, entry.lastUpdateId, [...entry.own]]
      );
      return rows[0]?.stamp ?? null;
    });
    entry.own.clear();
    entry.snapshotStamp = stamp ?? entry.snapshotStamp;
    entry.journalled = 0;
    options.peers?.announce(id);
  }

  /**
   * Writes a merge: the bytes of the fold that preceded it, the bytes that
   * came in (none when they were read from the journal), and the derived
   * content of the merged document; then tells the editor and the other
   * tabs. The merge is on disk or the copy is dropped.
   */
  async function writeMerge(
    id: string,
    entry: Open,
    blobs: Uint8Array[]
  ): Promise<void> {
    const folded = entry.pending.slice();
    let tree: SerializedTree | null;
    let markdown: string;
    try {
      tree = entry.crdt.toTree();
      // Derived before the transaction opens, as in restore.
      markdown = tree ? await treeAsMarkdown(tree) : '';
      await db.transaction(async (tx) => {
        for (const bytes of [...folded, ...blobs]) {
          const { rows } = await tx.query<{ id: number | string }>(
            'insert into document_update (document_id, bytes) values ($1, $2) returning id',
            [id, bytes]
          );
          entry.own.add(Number(rows[0]?.id));
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
    } catch (error) {
      // The import changed this copy and nothing of it reached the disk.
      // Kept, it would hold operations the editor never saw, and the next
      // fold would commit the editor's older tree over them. Dropped, the
      // next access rebuilds from the disk and the retry starts from there.
      drop(id, entry);
      throw error;
    } finally {
      entry.merging = false;
    }
    // On disk from here: whatever fails next must not undo it, and the
    // editor is told before anything else can fail.
    entry.pending.splice(0, folded.length);
    entry.journalled += folded.length + blobs.length;
    if (tree) {
      emit({
        id,
        source: 'remote',
        tree,
        markdown,
        localEdits: folded.length > 0,
      });
    }
    if (folded.length + blobs.length > 0) options.peers?.announce(id);
    if (entry.journalled >= JOURNAL_LIMIT) await snapshot(id, entry);
    if (entry.mergeAgain) {
      entry.mergeAgain = false;
      void mergeLocal(id).catch(reportMergeFailure);
    }
  }

  /**
   * Another tab wrote to the journal: what this copy has not seen comes in
   * the way a pull's bytes do — the editor's tree folded first, the merge
   * painted after. A document this tab does not hold open has nothing to
   * merge: it is read from the disk when it opens.
   */
  async function mergeLocal(id: string): Promise<void> {
    const entry = open.get(id);
    if (!entry) return;
    if (entry.merging) {
      entry.mergeAgain = true;
      return;
    }
    const read = await readJournal(id, entry);
    if (open.get(id) !== entry) return;
    if (entry.merging) {
      entry.mergeAgain = true;
      return;
    }
    if (read.blobs.length === 0) {
      applyJournal(entry, read);
      return;
    }
    foldLive(id, entry);
    applyJournal(entry, read);
    entry.generation += 1;
    entry.merging = true;
    await writeMerge(id, entry, []);
  }

  function reportMergeFailure(error: unknown): void {
    console.error("merging another tab's writes failed", error);
  }

  options.peers?.listen((id) => {
    void mergeLocal(id).catch(reportMergeFailure);
  });

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
      const read = await readJournal(input.id, entry);
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
      // The editor's tree first, against the state it was edited from; what
      // other tabs wrote since merges on top of it. The other order would
      // diff their writes away — the tree has never seen them.
      const changed = entry.crdt.commitTree(input.tree, input.author);
      const merged = applyJournal(entry, read);
      const updates = entry.pending.splice(0, entry.pending.length);
      if (!changed && !merged) return false;
      if (merged) {
        entry.generation += 1;
        entry.merging = true;
      }
      const tree = merged ? entry.crdt.toTree() : input.tree;
      let markdown = input.markdown;
      try {
        if (merged && tree) markdown = await treeAsMarkdown(tree);
        await db.transaction(async (tx) => {
          for (const bytes of updates) {
            const { rows } = await tx.query<{ id: number | string }>(
              'insert into document_update (document_id, bytes) values ($1, $2) returning id',
              [input.id, bytes]
            );
            entry.own.add(Number(rows[0]?.id));
          }
          if (tree) {
            await tx.query(
              `insert into document_content (document_id, lexical_json, markdown, writer)
               values ($1, $2, $3, $4)
               on conflict (document_id) do update
                 set lexical_json = excluded.lexical_json,
                     markdown = excluded.markdown,
                     writer = excluded.writer,
                     updated_at = now()`,
              [input.id, JSON.stringify(tree), markdown, input.writer ?? null]
            );
          }
          await tx.query(
            'update document set preview = $2, version_vv = $3, updated_at = now() where id = $1',
            [
              input.id,
              merged ? markdown.slice(0, 200) : input.preview,
              entry.crdt.versionBytes(),
            ]
          );
        });
      } catch (error) {
        // The commit is in this copy and not on disk: a retry of the same
        // tree would find nothing to change and the edit would never be
        // written. Dropped, the retry commits it again from the disk.
        drop(input.id, entry);
        throw error;
      } finally {
        entry.merging = false;
      }

      entry.journalled += updates.length;
      if (merged && tree) {
        // What other tabs wrote is now in the document: the editor shows it.
        emit({
          id: input.id,
          source: 'remote',
          tree,
          markdown,
          localEdits: changed,
        });
      } else if (changed) {
        emit({
          id: input.id,
          source: 'local',
          tree: input.tree,
          markdown: input.markdown,
        });
      }
      if (updates.length > 0) options.peers?.announce(input.id);
      if (entry.journalled >= JOURNAL_LIMIT) await snapshot(input.id, entry);
      return changed;
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
          const { rows } = await tx.query<{ id: number | string }>(
            'insert into document_update (document_id, bytes) values ($1, $2) returning id',
            [id, bytes]
          );
          entry.own.add(Number(rows[0]?.id));
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
      if (updates.length > 0) options.peers?.announce(id);
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
     * row for it (not materialized yet). Other tabs' journal rows are NOT
     * read here: brought in without the fold and the paint that frame every
     * merge, they would sit under an editor that never saw them. Each tab
     * pushes what it holds; the others' writes arrive by their announcements.
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
        await writeMerge(id, entry, blobs);
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
