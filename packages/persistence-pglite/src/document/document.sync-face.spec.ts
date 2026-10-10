import type { SerializedTree } from '@workspace/doc-crdt';
import { createDocumentSync, createPgliteLedger } from '@workspace/doc-sync';
import {
  createServerStandIn,
  type ServerStandIn,
} from '@workspace/doc-sync/testing';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import {
  createDocumentCrdtStore,
  type DocumentChanged,
} from './document.crdt-store.js';
import {
  listUnpushedDocuments,
  materializeDocuments,
} from './document.materialize.js';
import { createPgliteDocumentRepository } from './document.repository.js';

/**
 * Two devices, one shared document: real stores over real PGlite on both
 * sides, the real engine, the server stand-in in the middle. The subject is
 * the store's sync face — what a pull writes locally, and the rule that
 * folds an open editor's unsaved tree in BEFORE remote operations merge,
 * so neither side reverts the other.
 */
const AUTHOR = { user: 'tester', src: 'human' as const };
const SPACE = testId('spc');

const treeOf = (markdown: string): SerializedTree =>
  markdownToState(markdown).state as unknown as SerializedTree;

/** The same tree with paragraph `index` saying `text`; ids untouched, so it is an edit, not a replacement. */
function withParagraph(
  tree: SerializedTree,
  index: number,
  text: string
): SerializedTree {
  const copy = JSON.parse(JSON.stringify(tree)) as SerializedTree;
  const leaf = copy.root.children?.[index]?.children?.[0];
  if (!leaf) throw new Error(`no paragraph ${index}`);
  leaf.text = text;
  return copy;
}

const textOf = (tree: SerializedTree): string =>
  (tree.root.children ?? [])
    .map((p) => (p.children ?? []).map((c) => c.text ?? '').join(''))
    .join('\n');

type Device = {
  db: Awaited<ReturnType<typeof openTestDb>>;
  store: ReturnType<typeof createDocumentCrdtStore>;
  live: { tree: SerializedTree | null };
  events: DocumentChanged[];
  save(id: string, tree: SerializedTree): Promise<boolean>;
  push(id: string): Promise<{ pushedSeq: number | null }>;
  pull(id: string): Promise<unknown>;
  journalRows(id: string): Promise<number>;
};

async function device(name: string, server: ServerStandIn): Promise<Device> {
  const db = await openTestDb();
  const live = { tree: null as SerializedTree | null };
  const store = createDocumentCrdtStore(db, {
    live: { read: () => live.tree, author: AUTHOR },
  });
  const events: DocumentChanged[] = [];
  store.onChanged((event) => events.push(event));
  const engine = createDocumentSync({
    transport: server,
    ledger: createPgliteLedger(db),
    journal: store.syncJournal,
    writer: name,
    compaction: false,
  });
  const syncable = async (id: string) => {
    const doc = await store.syncable(id);
    if (!doc) throw new Error(`${name} has no row for ${id}`);
    return doc;
  };
  return {
    db,
    store,
    live,
    events,
    save: (id, tree) =>
      store.save({
        id,
        tree,
        markdown: textOf(tree),
        preview: '',
        author: AUTHOR,
      }),
    push: async (id) => engine.push(id, await syncable(id), SPACE),
    pull: async (id) => engine.pull(id, await syncable(id)),
    journalRows: async (id) =>
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from document_update where document_id = $1',
          [id]
        )
      ).rows[0]!.n,
  };
}

describe('a document shared by two devices', () => {
  let server: ServerStandIn;
  let a: Device;
  let b: Device;

  beforeEach(async () => {
    server = await createServerStandIn();
    a = await device('device-a', server);
    b = await device('device-b', server);
  }, 30_000);
  afterEach(async () => {
    await a.db.close();
    await b.db.close();
    await server.close();
  });

  /** A creates it; B receives the node through the graph and materializes the row. */
  async function sharedDocument(): Promise<string> {
    const documents = createPgliteDocumentRepository(
      a.db,
      a.store,
      SPACE,
      TEST_USER
    );
    const created = (
      await documents.create({ title: 'Shared' })
    )._unsafeUnwrap();
    await b.db.query(
      `insert into knowledge_resources (id, space_id, kind, title, created_by, body_ref)
       values ($1, $2, 'text', $3, $4, $5::jsonb)`,
      [
        testId('knr'),
        SPACE,
        'Shared',
        TEST_USER,
        JSON.stringify({ doc_id: created.id }),
      ]
    );
    await materializeDocuments(b.db, SPACE);
    return created.id;
  }

  it('opens on the second device as awaiting, then with the body once pulled', async () => {
    const id = await sharedDocument();
    const documentsB = createPgliteDocumentRepository(
      b.db,
      b.store,
      SPACE,
      TEST_USER
    );
    const before = (await documentsB.load(id))._unsafeUnwrap();
    expect(before.content).toBeNull();
    expect(before.awaitingSync).toBe(true);

    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);

    const after = (await documentsB.load(id))._unsafeUnwrap();
    expect(after.awaitingSync).toBe(false);
    expect(textOf(after.content!.tree)).toBe('Hello\nWorld');
    expect(after.content!.markdown).toContain('Hello');
    expect(b.events.at(-1)).toMatchObject({
      id,
      source: 'remote',
      localEdits: false,
    });
  });

  it('a document made here opens empty, not awaiting', async () => {
    const documents = createPgliteDocumentRepository(
      a.db,
      a.store,
      SPACE,
      TEST_USER
    );
    const created = (await documents.create({ title: 'Mine' }))._unsafeUnwrap();
    const loaded = (await documents.load(created.id))._unsafeUnwrap();
    expect(loaded.content).toBeNull();
    expect(loaded.awaitingSync).toBe(false);
  });

  it('a node opened before its document row was materialized waits instead of failing', async () => {
    const documentsA = createPgliteDocumentRepository(
      a.db,
      a.store,
      SPACE,
      TEST_USER
    );
    const created = (
      await documentsA.create({ title: 'Raced' })
    )._unsafeUnwrap();
    await a.save(created.id, treeOf('Body'));
    await a.push(created.id);
    // The explorer shows the node the moment the graph applies it; the
    // document row comes with the materializer a moment later.
    await b.db.query(
      `insert into knowledge_resources (id, space_id, kind, title, created_by, body_ref)
       values ($1, $2, 'text', $3, $4, $5::jsonb)`,
      [
        testId('knr'),
        SPACE,
        'Raced',
        TEST_USER,
        JSON.stringify({ doc_id: created.id }),
      ]
    );
    const documentsB = createPgliteDocumentRepository(
      b.db,
      b.store,
      SPACE,
      TEST_USER
    );
    const early = (await documentsB.load(created.id))._unsafeUnwrap();
    expect(early.content).toBeNull();
    expect(early.awaitingSync).toBe(true);
    expect(early.meta.title).toBe('Raced');

    await materializeDocuments(b.db, SPACE);
    await b.pull(created.id);
    const later = (await documentsB.load(created.id))._unsafeUnwrap();
    expect(textOf(later.content!.tree)).toBe('Body');
  });

  it('a document made here and pushed while still empty opens empty, not awaiting', async () => {
    const documents = createPgliteDocumentRepository(
      a.db,
      a.store,
      SPACE,
      TEST_USER
    );
    const created = (
      await documents.create({ title: 'Fresh' })
    )._unsafeUnwrap();
    // A catch-up push can reach a document before the first keystroke.
    await a.push(created.id);
    const loaded = (await documents.load(created.id))._unsafeUnwrap();
    expect(loaded.content).toBeNull();
    expect(loaded.awaitingSync).toBe(false);
  });

  it('a document the server holds nothing for stops awaiting after its first pull', async () => {
    const id = await sharedDocument();
    const documentsB = createPgliteDocumentRepository(
      b.db,
      b.store,
      SPACE,
      TEST_USER
    );
    expect((await documentsB.load(id))._unsafeUnwrap().awaitingSync).toBe(true);
    // A never typed into it, so the server has no row: asking is the answer.
    await b.pull(id);
    expect((await documentsB.load(id))._unsafeUnwrap().awaitingSync).toBe(
      false
    );
  });

  it('a document this device already opened reopens with the merged body', async () => {
    const id = await sharedDocument();
    const documentsB = createPgliteDocumentRepository(
      b.db,
      b.store,
      SPACE,
      TEST_USER
    );
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    // Opening it caches the content: switching back must cost no query.
    const first = (await documentsB.load(id))._unsafeUnwrap();
    expect(textOf(first.content!.tree)).toBe('Hello\nWorld');

    await a.save(id, withParagraph(first.content!.tree, 0, 'Hello A'));
    await a.push(id);
    await b.pull(id);

    // A stale cache here would reopen the old body, and the next save from
    // it would revert what the other device wrote.
    const again = (await documentsB.load(id))._unsafeUnwrap();
    expect(textOf(again.content!.tree)).toBe('Hello A\nWorld');
  });

  it('folds what the open editor holds in before importing, so neither side reverts the other', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    const pulled = (await b.store.load(id))!;

    // B is typing in the second paragraph and has not saved yet.
    b.live.tree = withParagraph(pulled, 1, 'World!');
    // A changes the first paragraph and pushes.
    await a.save(id, withParagraph(pulled, 0, 'Hello A'));
    await a.push(id);

    const rowsBefore = await b.journalRows(id);
    await b.pull(id);

    const merged = b.events.at(-1)!;
    expect(merged.source).toBe('remote');
    // The fold is an edit of this device's: whoever pushes must hear of it.
    expect(merged.localEdits).toBe(true);
    expect(textOf(merged.tree)).toBe('Hello A\nWorld!');
    const { rows } = await b.db.query<{ lexical_json: SerializedTree }>(
      'select lexical_json from document_content where document_id = $1',
      [id]
    );
    expect(textOf(rows[0]!.lexical_json)).toBe('Hello A\nWorld!');
    // The fold's bytes and the remote bytes both reached the journal.
    expect(await b.journalRows(id)).toBeGreaterThan(rowsBefore);
    // The save the editor had scheduled now carries the merged tree and writes nothing.
    expect(await b.save(id, merged.tree)).toBe(false);

    // The folded edit is B's own and was never sent: it must go out.
    expect((await b.push(id)).pushedSeq).not.toBeNull();
    await a.pull(id);
    expect(textOf((await a.store.load(id))!)).toBe('Hello A\nWorld!');
  });

  it('a fold journaled by a pull stays listed as unpushed until it is pushed', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    expect(await listUnpushedDocuments(b.db)).not.toContain(id);
    const pulled = (await b.store.load(id))!;
    b.live.tree = withParagraph(pulled, 1, 'World!');
    await a.save(id, withParagraph(pulled, 0, 'Hello A'));
    await a.push(id);
    await b.pull(id);
    // Found again after a restart: the list is read from the disk.
    expect(await listUnpushedDocuments(b.db)).toContain(id);
    await b.push(id);
    expect(await listUnpushedDocuments(b.db)).not.toContain(id);
  });

  it('keeps a folded edit when the journal write fails and the pull is retried', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    const pulled = (await b.store.load(id))!;
    b.live.tree = withParagraph(pulled, 1, 'World!');
    await a.save(id, withParagraph(pulled, 0, 'Hello A'));
    await a.push(id);

    // The journal write of the next pull fails once (a full disk, a
    // closing tab): its transaction rolls back.
    const original = b.db.transaction.bind(b.db);
    let failOnce = true;
    (b.db as { transaction: typeof original }).transaction = (async (
      ...args: Parameters<typeof original>
    ) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('disk full');
      }
      return original(...args);
    }) as typeof original;
    await expect(b.pull(id)).rejects.toThrow(/disk full/);
    await b.pull(id);

    // A restart rebuilds the document from what reached the disk.
    const reopened = createDocumentCrdtStore(b.db);
    expect(textOf((await reopened.load(id))!)).toBe('Hello A\nWorld!');
  });

  it('a snapshot that fails after the merge is on disk still paints the merge and reverts nothing', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    let tree = (await b.store.load(id))!;
    // The pane: whatever B's editor shows is what a remote change painted.
    b.store.onChanged((event) => {
      if (event.source === 'remote') b.live.tree = event.tree;
    });
    // Enough of B's own saves that the next journal write snapshots.
    for (let i = 1; i <= 18; i++) {
      tree = withParagraph(tree, 1, `World${'!'.repeat(i)}`);
      await b.save(id, tree);
    }
    b.live.tree = withParagraph(tree, 1, 'World typed');
    await a.save(id, withParagraph((await a.store.load(id))!, 0, 'Hello A'));
    await a.push(id);

    // The journal write commits; the snapshot after it fails.
    const original = b.db.transaction.bind(b.db);
    let calls = 0;
    (b.db as { transaction: typeof original }).transaction = (async (
      ...args: Parameters<typeof original>
    ) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full');
      return original(...args);
    }) as typeof original;
    await expect(b.pull(id)).rejects.toThrow(/disk full/);
    await b.pull(id);

    const reopened = createDocumentCrdtStore(b.db);
    expect(textOf((await reopened.load(id))!)).toBe('Hello A\nWorld typed');
  });

  it('a save racing the first open of its document is written', async () => {
    const documents = createPgliteDocumentRepository(
      a.db,
      a.store,
      SPACE,
      TEST_USER
    );
    const created = (
      await documents.create({ title: 'Raced' })
    )._unsafeUnwrap();
    // A fresh page: the catch-up push and the editor's first save open the
    // same document at the same moment.
    const store = createDocumentCrdtStore(a.db);
    const opening = store.syncable(created.id);
    const saved = store.save({
      id: created.id,
      tree: treeOf('Typed'),
      markdown: 'Typed',
      preview: '',
      author: AUTHOR,
    });
    await opening;
    expect(await saved).toBe(true);
    expect(
      textOf((await createDocumentCrdtStore(a.db).load(created.id))!)
    ).toBe('Typed');
  });

  it('a save whose open copy was dropped under it writes nothing', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    const pulled = (await b.store.load(id))!;
    const rowsBefore = await b.journalRows(id);
    const late = b.save(id, withParagraph(pulled, 1, 'World!'));
    // The copy it was writing through is gone (a failed merge, a restore):
    // what it would commit was diffed against state that is not on disk.
    b.store.close(id);
    expect(await late).toBe(false);
    expect(await b.journalRows(id)).toBe(rowsBefore);
  });

  it('refuses a save whose tree a merge in flight has made stale', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    const pulled = (await b.store.load(id))!;
    await a.save(id, withParagraph(pulled, 0, 'Hello A'));
    await a.push(id);

    // The engine's sequence, by hand, so a save can start in between.
    const face = (await b.store.syncable(id))!;
    const remote = (await server.tail(id, 1)).map((r) => r.bytes);
    const stale = b.save(id, withParagraph(pulled, 1, 'World!'));
    face.prepareImport();
    face.importUpdates(remote);
    expect(await stale).toBe(false);
    await b.store.syncJournal.append(id, remote);
    expect(textOf((await b.store.load(id))!)).toBe('Hello A\nWorld');
  });

  it('a save the merge refused leaves the cached body as it was', async () => {
    const id = await sharedDocument();
    const documentsB = createPgliteDocumentRepository(
      b.db,
      b.store,
      SPACE,
      TEST_USER
    );
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    const pulled = (await documentsB.load(id))._unsafeUnwrap().content!.tree;
    await a.save(id, withParagraph(pulled, 0, 'Hello A'));
    await a.push(id);

    const face = (await b.store.syncable(id))!;
    const remote = (await server.tail(id, 1)).map((r) => r.bytes);
    face.prepareImport();
    face.importUpdates(remote);
    const stale = withParagraph(pulled, 1, 'World!');
    const saved = await documentsB.save({
      id,
      tree: stale,
      markdown: textOf(stale),
      preview: '',
      author: AUTHOR,
    });
    expect(saved._unsafeUnwrap()).toBe(false);
    // Reopening must not hand back the tree the store refused.
    const reopened = (await documentsB.load(id))._unsafeUnwrap();
    expect(textOf(reopened.content!.tree)).toBe('Hello\nWorld');
    await b.store.syncJournal.append(id, remote);
    const merged = (await documentsB.load(id))._unsafeUnwrap();
    expect(textOf(merged.content!.tree)).toBe('Hello A\nWorld');
  });

  it('a push opening the document mid-merge does not let a stale save through', async () => {
    const id = await sharedDocument();
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.push(id);
    await b.pull(id);
    const pulled = (await b.store.load(id))!;
    await a.save(id, withParagraph(pulled, 0, 'Hello A'));
    await a.push(id);

    const face = (await b.store.syncable(id))!;
    const remote = (await server.tail(id, 1)).map((r) => r.bytes);
    face.prepareImport();
    face.importUpdates(remote);
    // A push takes the document while the merge waits for its journal write.
    await b.store.syncable(id);
    // A save debounced before the merge lands now: its tree predates it.
    expect(await b.save(id, withParagraph(pulled, 1, 'World!'))).toBe(false);
    await b.store.syncJournal.append(id, remote);
    expect(textOf((await b.store.load(id))!)).toBe('Hello A\nWorld');
  });
});
