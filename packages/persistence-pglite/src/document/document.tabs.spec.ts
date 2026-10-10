import type { SerializedTree } from '@workspace/doc-crdt';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, testId, TEST_USER } from '../graph/graph.test-db.js';
import {
  createDocumentCrdtStore,
  type DocumentChanged,
  type DocumentPeers,
} from './document.crdt-store.js';
import { createPgliteDocumentRepository } from './document.repository.js';

/**
 * Two tabs of one browser: one local database, two stores, each holding
 * its own copy of an open document, and an editor in each. What one tab
 * writes must reach the other tab's editor, and neither tab's typing may
 * erase the other's — whichever saves first, and whatever the other has
 * not seen yet.
 */
const AUTHOR = { user: 'tester', src: 'human' as const };
const SPACE = testId('spc');

const treeOf = (markdown: string): SerializedTree =>
  markdownToState(markdown).state as unknown as SerializedTree;

/** The same tree with paragraph `index` saying `text`; ids untouched. */
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

/**
 * The tabs' announcements, delivered like a broadcast channel: to every
 * other tab, after the current task. `hold` keeps them back, for a tab
 * that has not heard yet.
 */
function createBus() {
  const listeners = new Set<(id: string, from: object) => void>();
  let held = false;
  const queue: Array<() => void> = [];
  return {
    peers(): DocumentPeers {
      const self = {};
      return {
        announce(id) {
          const deliver = () => {
            for (const listener of listeners) listener(id, self);
          };
          if (held) queue.push(deliver);
          else setTimeout(deliver, 0);
        },
        listen(onAnnounce) {
          const listener = (id: string, from: object) => {
            if (from !== self) onAnnounce(id);
          };
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
      for (const deliver of queue.splice(0)) setTimeout(deliver, 0);
    },
  };
}

type Tab = {
  store: ReturnType<typeof createDocumentCrdtStore>;
  editor: { tree: SerializedTree | null };
  events: DocumentChanged[];
  save(id: string, tree: SerializedTree): Promise<boolean>;
};

describe('two tabs over one local database', () => {
  let db: Awaited<ReturnType<typeof openTestDb>>;
  let bus: ReturnType<typeof createBus>;

  beforeEach(async () => {
    db = await openTestDb();
    bus = createBus();
  }, 30_000);
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.close();
  });

  function tab(): Tab {
    const editor = { tree: null as SerializedTree | null };
    const store = createDocumentCrdtStore(db, {
      live: { read: () => editor.tree, author: AUTHOR },
      peers: bus.peers(),
    });
    const events: DocumentChanged[] = [];
    // The pane: a change from elsewhere is painted into the editor.
    store.onChanged((event) => {
      events.push(event);
      if (event.source === 'remote') editor.tree = event.tree;
    });
    return {
      store,
      editor,
      events,
      save: async (id, tree) => {
        editor.tree = tree;
        return store.save({
          id,
          tree,
          markdown: textOf(tree),
          preview: '',
          author: AUTHOR,
        });
      },
    };
  }

  /** A document both tabs have open, saying "Hello" / "World". */
  async function openInBoth(a: Tab, b: Tab): Promise<string> {
    const id = (
      await createPgliteDocumentRepository(
        db,
        a.store,
        SPACE,
        TEST_USER
      ).create({ title: 'Shared' })
    )._unsafeUnwrap().id;
    await a.save(id, treeOf('Hello\n\nWorld'));
    b.editor.tree = (await b.store.load(id))!;
    return id;
  }

  const onDisk = async (id: string) =>
    textOf((await createDocumentCrdtStore(db).load(id))!);

  it("paints one tab's save into the other tab's open editor", async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await a.save(id, withParagraph(a.editor.tree!, 0, 'Hello from A'));
    await expect
      .poll(() => (b.editor.tree ? textOf(b.editor.tree) : ''))
      .toBe('Hello from A\nWorld');
    expect(b.events.at(-1)).toMatchObject({ id, source: 'remote' });
  });

  it("keeps both edits when a tab saves before it heard of the other's", async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.hold();
    await a.save(id, withParagraph(a.editor.tree!, 0, 'Hello from A'));
    // B types on what it saw: A's edit has not reached it.
    await b.save(id, withParagraph(b.editor.tree!, 1, 'World from B'));
    expect(await onDisk(id)).toBe('Hello from A\nWorld from B');
    // And B's editor shows the merge at once: its save brought it in.
    expect(textOf(b.editor.tree!)).toBe('Hello from A\nWorld from B');
    bus.release();
    await expect
      .poll(() => textOf(a.editor.tree!))
      .toBe('Hello from A\nWorld from B');
  });

  it("folds the other tab's unsaved typing in before painting a merge", async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // B is typing and its save has not fired yet.
    b.editor.tree = withParagraph(b.editor.tree!, 1, 'World typed');
    await a.save(id, withParagraph(a.editor.tree!, 0, 'Hello from A'));
    await expect
      .poll(() => textOf(b.editor.tree!))
      .toBe('Hello from A\nWorld typed');
    // The fold is B's own edit: told so, so that it is pushed.
    expect(b.events.at(-1)).toMatchObject({ localEdits: true });
    expect(await onDisk(id)).toBe('Hello from A\nWorld typed');
  });

  it("keeps the other tab's rows when one tab snapshots, and that tab still hears of them", async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A's journal one row short of its snapshot threshold.
    for (let i = 1; i <= 18; i++) {
      await a.save(
        id,
        withParagraph(a.editor.tree!, 0, `Hello${'!'.repeat(i)}`)
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    bus.hold();
    // B writes; A has not read it.
    await b.save(id, withParagraph(b.editor.tree!, 1, 'World from B'));
    // A's next journal write — a pull, which reads nothing else — snapshots.
    const face = (await a.store.syncable(id))!;
    await a.store.syncJournal.append(id, [
      face.exportUpdatesSince(face.versionBytes()),
    ]);
    expect(await onDisk(id)).toBe(`Hello${'!'.repeat(18)}\nWorld from B`);
    bus.release();
    // B never read A's rows the snapshot folded away; it still gets them,
    // and A gets B's.
    await expect
      .poll(() => textOf(a.editor.tree!))
      .toBe(`Hello${'!'.repeat(18)}\nWorld from B`);
    await expect
      .poll(() => textOf(b.editor.tree!))
      .toBe(`Hello${'!'.repeat(18)}\nWorld from B`);
  });

  it('brings in what another tab folded into a snapshot before this tab read it', async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // B hears nothing while A writes enough to snapshot: A's rows are
    // folded away before B ever reads them.
    bus.hold();
    for (let i = 1; i <= 18; i++) {
      await a.save(
        id,
        withParagraph(a.editor.tree!, 0, `Hello${'!'.repeat(i)}`)
      );
    }
    const face = (await a.store.syncable(id))!;
    await a.store.syncJournal.append(id, [
      face.exportUpdatesSince(face.versionBytes()),
    ]);
    bus.release();
    await expect
      .poll(() => textOf(b.editor.tree!))
      .toBe(`Hello${'!'.repeat(18)}\nWorld`);
  });

  it("reopens with the merge when a tab's save brought the other tab's write in", async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    const documentsB = createPgliteDocumentRepository(
      db,
      b.store,
      SPACE,
      TEST_USER
    );
    await documentsB.load(id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.hold();
    await a.save(id, withParagraph(a.editor.tree!, 0, 'Hello from A'));
    const typed = withParagraph(b.editor.tree!, 1, 'World from B');
    expect(
      (
        await documentsB.save({
          id,
          tree: typed,
          markdown: textOf(typed),
          preview: '',
          author: AUTHOR,
        })
      )._unsafeUnwrap()
    ).toBe(true);
    const reopened = (await documentsB.load(id))._unsafeUnwrap();
    expect(textOf(reopened.content!.tree)).toBe('Hello from A\nWorld from B');
  });

  it("does not replace another tab's newer snapshot from a copy that is behind", async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.hold();
    // B saves until its journal snapshots: its rows are folded away.
    for (let i = 1; i <= 19; i++) {
      await b.save(
        id,
        withParagraph(b.editor.tree!, 1, `World${'?'.repeat(i)}`)
      );
    }
    // A, which never heard of any of it, reaches its own threshold through
    // a pull.
    const face = (await a.store.syncable(id))!;
    const empty = face.exportUpdatesSince(face.versionBytes());
    await a.store.syncJournal.append(
      id,
      Array.from({ length: 19 }, () => empty)
    );
    expect(await onDisk(id)).toBe(`Hello\nWorld${'?'.repeat(19)}`);
    bus.release();
    await expect
      .poll(() => textOf(a.editor.tree!))
      .toBe(`Hello\nWorld${'?'.repeat(19)}`);
  });

  it('opens a document whole while another tab snapshots it', async () => {
    const a = tab();
    const id = (
      await createPgliteDocumentRepository(
        db,
        a.store,
        SPACE,
        TEST_USER
      ).create({ title: 'Shared' })
    )._unsafeUnwrap().id;
    await a.save(id, treeOf('Hello\n\nWorld'));
    await a.save(id, withParagraph(a.editor.tree!, 0, 'Hello again'));

    // Between reading the snapshot and the journal, another tab writes a
    // snapshot and trims the journal it folded.
    let interleave: (() => Promise<void>) | undefined = async () => {
      const full = (await createDocumentCrdtStore(db).syncable(id))!;
      await db.query(
        `insert into document_snapshot (document_id, bytes, frontiers, op_count, updated_at)
         values ($1, $2, '[]', 0, now())
         on conflict (document_id) do update set bytes = excluded.bytes, updated_at = now()`,
        [id, full.exportSnapshot()]
      );
      await db.query('delete from document_update where document_id = $1', [
        id,
      ]);
    };
    const watched = new Proxy(db, {
      get(target, property) {
        if (property === 'query') {
          return async (sql: string, params?: unknown[]) => {
            const result = await target.query(sql, params);
            if (interleave && /from document_snapshot/.test(sql)) {
              const run = interleave;
              interleave = undefined;
              await run();
            }
            return result;
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const c = createDocumentCrdtStore(watched);
    expect(textOf((await c.load(id))!)).toBe('Hello again\nWorld');
  });

  it('takes in what other tabs wrote before handing a document to the sync engine', async () => {
    const a = tab();
    const b = tab();
    const id = await openInBoth(a, b);
    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.hold();
    await a.save(id, withParagraph(a.editor.tree!, 0, 'Hello from A'));
    // B pushes or pulls: it must not do so from a copy that is behind.
    await b.store.syncable(id);
    expect(textOf(b.editor.tree!)).toBe('Hello from A\nWorld');
  });
});
