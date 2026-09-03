import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import {
  createOptimisticEntities,
  createOptimisticOverlay,
  type Intent,
  insertRow,
  patchRow,
  project,
  type Row,
  removeRows,
} from './optimistic.js';

type State = { name: string };

/** A source we drive by hand: `deliver` is what the live query would do. */
function fakeSource<T = State>() {
  let listener: ((s: T) => void) | undefined;
  let subscriptions = 0;
  return {
    subscribe: (cb: (s: T) => void) => {
      listener = cb;
      subscriptions++;
      return () => {
        listener = undefined;
        subscriptions--;
      };
    },
    deliver: (s: T) => listener?.(s),
    subscriptions: () => subscriptions,
  };
}

const renameTo = (name: string): Intent<State> => ({
  project: () => ({ name }),
  reflected: (s) => s.name === name,
});

/** A command that settles only when the test says so. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('optimistic overlay', () => {
  it('shows the intent before the command settles and lifts it when the source reflects it', async () => {
    const source = fakeSource();
    const overlay = createOptimisticOverlay(source.subscribe);
    const seen: string[] = [];
    overlay.watch((s) => seen.push(s.name));
    source.deliver({ name: 'old' });

    const command = deferred<ReturnType<typeof ok<void, string>>>();
    const running = overlay.run(renameTo('new'), () => command.promise);
    expect(seen).toEqual(['old', 'new']);
    expect(overlay.pending()).toBe(1);

    // A stale delivery — the source has not caught up — must not flicker back.
    source.deliver({ name: 'old' });
    expect(seen.at(-1)).toBe('new');

    command.resolve(ok(undefined));
    await running;
    expect(overlay.pending()).toBe(1);

    source.deliver({ name: 'new' });
    expect(overlay.pending()).toBe(0);
    expect(seen.at(-1)).toBe('new');
  });

  it('drops the intent when the command fails, falling back to the source', async () => {
    const source = fakeSource();
    const overlay = createOptimisticOverlay(source.subscribe);
    const seen: string[] = [];
    overlay.watch((s) => seen.push(s.name));
    source.deliver({ name: 'old' });

    const result = await overlay.run(renameTo('new'), async () =>
      err('refused')
    );
    expect(result.isErr()).toBe(true);
    expect(seen).toEqual(['old', 'new', 'old']);
    expect(overlay.pending()).toBe(0);
  });

  it('drops the intent when the command throws and rethrows', async () => {
    const source = fakeSource();
    const overlay = createOptimisticOverlay(source.subscribe);
    const seen: string[] = [];
    overlay.watch((s) => seen.push(s.name));
    source.deliver({ name: 'old' });

    await expect(
      overlay.run(renameTo('new'), async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(seen.at(-1)).toBe('old');
    expect(overlay.pending()).toBe(0);
  });

  it('gives up on a settled intent the source never reflects, after two deliveries', async () => {
    const source = fakeSource();
    const overlay = createOptimisticOverlay(source.subscribe);
    const seen: string[] = [];
    overlay.watch((s) => seen.push(s.name));
    source.deliver({ name: 'old' });

    await overlay.run(renameTo('new'), async () => ok(undefined));
    source.deliver({ name: 'other' });
    expect(seen.at(-1)).toBe('new');
    source.deliver({ name: 'other' });
    expect(seen.at(-1)).toBe('other');
    expect(overlay.pending()).toBe(0);
  });

  it('lifts immediately when the source already showed the outcome by the time the command settled', async () => {
    const source = fakeSource();
    const overlay = createOptimisticOverlay(source.subscribe);
    overlay.watch(() => {});
    source.deliver({ name: 'old' });

    const command = deferred<ReturnType<typeof ok<void, string>>>();
    const running = overlay.run(renameTo('new'), () => command.promise);
    source.deliver({ name: 'new' });
    command.resolve(ok(undefined));
    await running;
    expect(overlay.pending()).toBe(0);
  });

  it('stacks intents in order and shares one source subscription across watchers', async () => {
    const source = fakeSource();
    const overlay = createOptimisticOverlay(source.subscribe);
    const a: string[] = [];
    const b: string[] = [];
    const offA = overlay.watch((s) => a.push(s.name));
    source.deliver({ name: 'old' });
    const offB = overlay.watch((s) => b.push(s.name));
    expect(source.subscriptions()).toBe(1);
    expect(b).toEqual(['old']);

    const first = deferred<ReturnType<typeof ok<void, string>>>();
    const second = deferred<ReturnType<typeof ok<void, string>>>();
    const r1 = overlay.run(renameTo('one'), () => first.promise);
    const r2 = overlay.run(renameTo('two'), () => second.promise);
    expect(a.at(-1)).toBe('two');
    expect(b.at(-1)).toBe('two');

    first.resolve(ok(undefined));
    second.resolve(ok(undefined));
    await Promise.all([r1, r2]);
    // The source showing 'two' means 'one' landed as well: both lift, and
    // the view must not fall back to the intermediate name.
    source.deliver({ name: 'two' });
    expect(overlay.pending()).toBe(0);
    expect(a.at(-1)).toBe('two');

    offA();
    expect(source.subscriptions()).toBe(1);
    offB();
    expect(source.subscriptions()).toBe(0);
  });
});

type Item = Row & { name: string; parentId: string | null };

const item = (id: string, name = id, parentId: string | null = null): Item => ({
  id,
  name,
  parentId,
});

const byName = (rows: readonly Item[]) =>
  [...rows].sort((a, b) => a.name.localeCompare(b.name));

describe('row intents', () => {
  const rows = [item('a', 'apple'), item('b', 'pear'), item('c', 'plum', 'b')];

  it('patch changes fields and re-sorts, and is reflected only by the new values', () => {
    const intent = patchRow<Item>('b', { name: 'banana' }, byName);
    const out = intent.project(rows);
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(out.find((r) => r.id === 'b')?.name).toBe('banana');
    expect(intent.reflected(out)).toBe(true);
    expect(intent.reflected(rows)).toBe(false);
  });

  it('patch compares dates by value, not identity', () => {
    type Dated = Row & { at: Date };
    const at = new Date(2026, 0, 1);
    const intent = patchRow<Dated>('x', { at });
    expect(intent.reflected([{ id: 'x', at: new Date(at.getTime()) }])).toBe(
      true
    );
    expect(intent.reflected([{ id: 'x', at: new Date(0) }])).toBe(false);
  });

  it('insert adds a row once, and stays reflected once the source has it', () => {
    const intent = insertRow<Item>(item('d', 'cherry'), byName);
    const out = intent.project(rows);
    expect(out.map((r) => r.id)).toEqual(['a', 'd', 'b', 'c']);
    // The source delivering the real row must not double it.
    expect(intent.project(out).filter((r) => r.id === 'd')).toHaveLength(1);
    expect(intent.reflected(rows)).toBe(false);
    expect(intent.reflected(out)).toBe(true);
  });

  it('remove resolves its rows once, against the state it was issued against', () => {
    const intent = removeRows<Item>((current) =>
      current.filter((r) => r.id === 'b' || r.parentId === 'b').map((r) => r.id)
    );
    const out = intent.project(rows);
    expect(out.map((r) => r.id)).toEqual(['a']);
    // Re-selecting against the shrunken state would match nothing and
    // resurrect the subtree; the selection is made once.
    expect(intent.project(out).map((r) => r.id)).toEqual(['a']);
    expect(intent.reflected(out)).toBe(true);
    expect(intent.reflected(rows)).toBe(false);
  });
});

describe('optimistic entities', () => {
  it('projects one command into every read model of its entity', async () => {
    const entities = createOptimisticEntities();
    const tree = fakeSource<Item[]>();
    const recent = fakeSource<Item[]>();
    const watchTree = entities.source<Item>('file', tree.subscribe);
    const watchRecent = entities.source<Item>('file', recent.subscribe);

    const fromTree: string[][] = [];
    const fromRecent: string[][] = [];
    watchTree.watch((rows) => fromTree.push(rows.map((r) => r.name)));
    watchRecent.watch((rows) => fromRecent.push(rows.map((r) => r.name)));
    tree.deliver([item('a', 'apple')]);
    recent.deliver([item('a', 'apple')]);

    const command = deferred<ReturnType<typeof ok<void, string>>>();
    const running = entities.run(
      [project<Item>('file', patchRow<Item>('a', { name: 'apricot' }))],
      () => command.promise
    );
    expect(fromTree.at(-1)).toEqual(['apricot']);
    expect(fromRecent.at(-1)).toEqual(['apricot']);
    expect(entities.pending('file')).toBe(1);

    command.resolve(ok(undefined));
    await running;
    tree.deliver([item('a', 'apricot')]);
    recent.deliver([item('a', 'apricot')]);
    expect(entities.pending()).toBe(0);
  });

  it('keeps entities apart and reaches several of them in one command', async () => {
    const entities = createOptimisticEntities();
    const files = fakeSource<Item[]>();
    const documents = fakeSource<Item[]>();
    const watchFiles = entities.source<Item>('file', files.subscribe);
    const watchDocuments = entities.source<Item>(
      'document',
      documents.subscribe
    );
    const seenFiles: string[][] = [];
    const seenDocuments: string[][] = [];
    watchFiles.watch((rows) => seenFiles.push(rows.map((r) => r.name)));
    watchDocuments.watch((rows) => seenDocuments.push(rows.map((r) => r.name)));
    files.deliver([item('node', 'draft')]);
    documents.deliver([item('doc', 'draft')]);

    const command = deferred<ReturnType<typeof ok<void, string>>>();
    const running = entities.run(
      [
        project<Item>('file', patchRow<Item>('node', { name: 'final' })),
        project<Item>('document', patchRow<Item>('doc', { name: 'final' })),
      ],
      () => command.promise
    );
    expect(seenFiles.at(-1)).toEqual(['final']);
    expect(seenDocuments.at(-1)).toEqual(['final']);

    command.resolve(ok(undefined));
    await running;
    expect(entities.pending('chat')).toBe(0);
  });

  it('rolls every read model back when the command fails', async () => {
    const entities = createOptimisticEntities();
    const files = fakeSource<Item[]>();
    const watched = entities.source<Item>('file', files.subscribe);
    const seen: string[][] = [];
    watched.watch((rows) => seen.push(rows.map((r) => r.name)));
    files.deliver([item('a', 'apple')]);

    const result = await entities.run(
      [project<Item>('file', patchRow<Item>('a', { name: 'apricot' }))],
      async () => err('refused')
    );
    expect(result.isErr()).toBe(true);
    expect(seen).toEqual([['apple'], ['apricot'], ['apple']]);
    expect(entities.pending()).toBe(0);
  });
});

describe('a command issued before the source has answered', () => {
  it('is still shown, projected onto the empty list a query starts from', async () => {
    const entities = createOptimisticEntities();
    const slow = fakeSource<Item[]>();
    const watched = entities.source<Item>('file', slow.subscribe);
    const seen: string[][] = [];
    watched.watch((rows) => seen.push(rows.map((r) => r.name)));

    // The live query has delivered nothing yet — start-up on a busy
    // connection takes seconds, and a creation in that window must show.
    const command = deferred<ReturnType<typeof ok<void, string>>>();
    const running = entities.run(
      [project<Item>('file', insertRow<Item>(item('new', 'Fresh')))],
      () => command.promise
    );
    expect(seen.at(-1)).toEqual(['Fresh']);

    command.resolve(ok(undefined));
    await running;
    slow.deliver([item('new', 'Fresh')]);
    expect(entities.pending()).toBe(0);
    expect(seen.at(-1)).toEqual(['Fresh']);
  });
});

describe('a watcher that subscribes after another one', () => {
  it('hears nothing until the source has actually delivered', () => {
    const entities = createOptimisticEntities();
    const slow = fakeSource<Item[]>();
    const watched = entities.source<Item>('document', slow.subscribe);
    watched.watch(() => {});

    // A caller that reads the first delivery as the truth — "is there a
    // document already?" — must not be told "no" before the query answers.
    const late: Item[][] = [];
    watched.watch((rows) => late.push(rows));
    expect(late).toEqual([]);

    slow.deliver([item('a', 'apple')]);
    expect(late.at(-1)?.map((r) => r.name)).toEqual(['apple']);
  });
});
