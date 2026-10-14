import { entityIdRegistry } from '@workspace/entity-id';
import { LoroDoc } from 'loro-crdt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpacePassOutcome } from './document-sync.js';
import {
  createServerStandIn,
  type ServerStandIn,
} from './testing/server-stand-in.js';
import { RESOURCE_ID, SPACE_ID } from './testing/replica.js';
import {
  createSpaceReplica,
  type SpaceReplica,
} from './testing/space-replica.js';
import type { SyncTransport } from './types.js';

/**
 * The space level of the protocol: one question per pass answers which
 * documents moved, and the per-document pull does the rest. The stand-in
 * runs the server's own seq-assignment rule, so the first group is that
 * rule under test — a mutant without the trigger (table-global seq) fails
 * the per-document numbering.
 */
const { documentIdFactory, writerIdFactory } = entityIdRegistry.factories;
const DOC_A = documentIdFactory.brand('doc_000000000000000a.0000000000');
const DOC_B = documentIdFactory.brand('doc_000000000000000b.0000000000');
const DOC_C = documentIdFactory.brand('doc_000000000000000c.0000000000');
const NO_ROW = documentIdFactory.brand('doc_00000000000000zz.0000000000');
/** A writer that is no replica of these tests. */
const W = writerIdFactory.create();
const blob = (text: string) => new TextEncoder().encode(text);
/** What a document holding no operations at all reports as its version. */
const emptyVersion = () => new LoroDoc().version().encode();

describe('the server assigns seq per document', () => {
  let server: ServerStandIn;

  beforeEach(async () => {
    server = await createServerStandIn();
  });
  afterEach(async () => {
    await server.close();
  });

  it('numbers each document from 1 with no gaps and tracks the head', async () => {
    await server.ensureDocument(DOC_A, SPACE_ID, RESOURCE_ID);
    await server.ensureDocument(DOC_B, SPACE_ID, RESOURCE_ID);
    expect(await server.pushUpdate(DOC_A, blob('a1'), W)).toBe(1);
    expect(await server.pushUpdate(DOC_B, blob('b1'), W)).toBe(1);
    expect(await server.pushUpdate(DOC_A, blob('a2'), W)).toBe(2);
    const page = await server.heads(SPACE_ID, null, 10, 0);
    expect(page.hasMore).toBe(false);
    expect(page.rows.map((h) => [h.docId, h.headSeq])).toEqual(
      expect.arrayContaining([
        [DOC_A, 2],
        [DOC_B, 1],
      ])
    );
  });

  it('keeps the head through compaction and continues from it', async () => {
    await server.ensureDocument(DOC_A, SPACE_ID, RESOURCE_ID);
    await server.pushUpdate(DOC_A, blob('a1'), W);
    await server.pushUpdate(DOC_A, blob('a2'), W);
    expect(await server.compact(DOC_A, blob('snapshot'), 2)).toBe(true);
    expect(await server.updateCount(DOC_A)).toBe(0);
    expect(await server.pushUpdate(DOC_A, blob('a3'), W)).toBe(3);
    const [head] = (await server.heads(SPACE_ID, null, 10, 0)).rows;
    expect(head?.headSeq).toBe(3);
  });

  it('refuses an update for a document that has no row', async () => {
    await expect(server.pushUpdate(NO_ROW, blob('x'), W)).rejects.toThrow(
      /not found/
    );
  });

  it('pages heads oldest first and honours the cursor', async () => {
    for (const id of [DOC_A, DOC_B, DOC_C]) {
      await server.ensureDocument(id, SPACE_ID, RESOURCE_ID);
      await server.pushUpdate(id, blob(id), W);
    }
    const first = await server.heads(SPACE_ID, null, 2, 0);
    expect(first.rows.map((h) => h.docId)).toEqual([DOC_A, DOC_B]);
    expect(first.hasMore).toBe(true);
    const second = await server.heads(SPACE_ID, null, 2, 2);
    expect(second.rows.map((h) => h.docId)).toEqual([DOC_C]);
    expect(second.hasMore).toBe(false);
    // `since` is inclusive (the overlap window relies on it); a JS Date
    // truncates the server's microseconds, so one millisecond past the
    // newest head provably excludes it, and the head itself is included.
    const newest = second.rows[0]!.updatedAt;
    const fromNewest = await server.heads(SPACE_ID, newest, 10, 0);
    expect(fromNewest.rows.map((h) => h.docId)).toContain(DOC_C);
    const pastNewest = await server.heads(
      SPACE_ID,
      new Date(newest.getTime() + 1),
      10,
      0
    );
    expect(pastNewest.rows).toEqual([]);
  });
});

describe('the space feed', () => {
  let server: ServerStandIn;
  const replicas: SpaceReplica[] = [];

  async function replica(
    name: string,
    options?: Parameters<typeof createSpaceReplica>[2],
    transport: SyncTransport = server
  ) {
    const r = await createSpaceReplica(name, transport, options);
    replicas.push(r);
    return r;
  }

  beforeEach(async () => {
    server = await createServerStandIn();
  });
  afterEach(async () => {
    await Promise.all(replicas.splice(0).map((r) => r.close()));
    await server.close();
  });

  it('pulls every document whose head moved past what this replica holds', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);
    await a.edit(DOC_B, 'beta. ');
    await a.push(DOC_B);

    const pulled: string[] = [];
    const watch = b.watchSpace({ onPulled: (docId) => pulled.push(docId) });
    await expect.poll(() => b.text(DOC_B), { timeout: 5_000 }).toBe('beta. ');
    expect(b.text(DOC_A)).toBe('alpha. ');
    expect(pulled.sort()).toEqual([DOC_A, DOC_B]);
    expect((await b.ledger().read(DOC_A)).pulledSeq).toBe(1);
    expect(await b.headsCursor()).not.toBeNull();
    watch.stop();
  });

  it('skips a document it cannot open without holding the others or the cursor back', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b', { blocked: [DOC_B] });
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);
    await a.edit(DOC_B, 'beta. ');
    await a.push(DOC_B);

    const outcomes: SpacePassOutcome[] = [];
    const watch = b.watchSpace({ onPass: (o) => outcomes.push(o) });
    await expect.poll(() => outcomes.length).toBeGreaterThan(0);
    expect(outcomes[0]).toEqual({ pulled: 1, skipped: 1, refused: 0 });
    expect(b.text(DOC_A)).toBe('alpha. ');
    expect(b.has(DOC_B)).toBe(false);
    // A head this device has no row for is the materializer's to bring in
    // later; it must not pin every later pass to re-reading the space.
    expect(await b.headsCursor()).not.toBeNull();
    watch.stop();
  });

  /** The stand-in, with every heads read recorded and holdable. */
  function recorded() {
    let gate: Promise<void> | null = null;
    const heads = vi.fn(async (...args: Parameters<SyncTransport['heads']>) => {
      if (gate) await gate;
      return server.heads(...args);
    });
    const subscribeSpace = vi.fn(server.subscribeSpace);
    const transport: SyncTransport = { ...server, heads, subscribeSpace };
    return {
      transport,
      heads,
      subscribeSpace,
      /** Heads reads wait until the returned release is called. */
      hold() {
        let release!: () => void;
        gate = new Promise<void>((resolve) => {
          release = () => {
            gate = null;
            resolve();
          };
        });
        return release;
      },
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps no clock: after its first pass, nothing runs until it is kicked', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const spy = recorded();
    const b = await replica('client-b', {}, spy.transport);
    let passes = 0;
    const watch = b.watchSpace({ onPass: () => (passes += 1) });
    await expect.poll(() => passes).toBe(1);
    const reads = spy.heads.mock.calls.length;

    vi.advanceTimersByTime(10 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(spy.heads.mock.calls.length).toBe(reads);
    expect(passes).toBe(1);
    watch.stop();
  });

  it('opens no nudge subscription of its own', async () => {
    const spy = recorded();
    const b = await replica('client-b', {}, spy.transport);
    let passes = 0;
    const watch = b.watchSpace({ onPass: () => (passes += 1) });
    await expect.poll(() => passes).toBe(1);
    expect(spy.subscribeSpace).not.toHaveBeenCalled();
    watch.stop();
  });

  it('a kick reads from the cursor; a full kick reads every head', async () => {
    const spy = recorded();
    const a = await replica('client-a');
    const b = await replica('client-b', {}, spy.transport);
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);
    let passes = 0;
    const watch = b.watchSpace({ onPass: () => (passes += 1) });
    await expect.poll(() => passes).toBe(1);
    // The first pass of every watch reads every head.
    expect(spy.heads.mock.calls[0]?.[1]).toBeNull();

    await a.edit(DOC_A, 'beta. ');
    await a.push(DOC_A);
    spy.heads.mockClear();
    watch.kick();
    await expect.poll(() => passes).toBe(2);
    expect(spy.heads.mock.calls[0]?.[1]).toBeInstanceOf(Date);
    expect(b.text(DOC_A)).toBe('alpha. beta. ');

    spy.heads.mockClear();
    watch.kick({ full: true });
    await expect.poll(() => passes).toBe(3);
    expect(spy.heads.mock.calls[0]?.[1]).toBeNull();
    watch.stop();
  });

  it('kicks during a pass run exactly one more, and a full read asked for is kept', async () => {
    const spy = recorded();
    const a = await replica('client-a');
    const b = await replica('client-b', {}, spy.transport);
    // A space with a head in it, so a plain pass has a cursor to read from.
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);
    let passes = 0;
    const watch = b.watchSpace({ onPass: () => (passes += 1) });
    await expect.poll(() => passes).toBe(1);

    const release = spy.hold();
    spy.heads.mockClear();
    watch.kick();
    await expect.poll(() => spy.heads.mock.calls.length).toBe(1);
    watch.kick({ full: true });
    watch.kick();
    watch.kick();
    release();

    await expect.poll(() => passes).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(passes).toBe(3);
    expect(spy.heads.mock.calls.map((call) => call[1] === null)).toEqual([
      false,
      true,
    ]);
    watch.stop();
  });

  it('stops: a kick after the stop reads nothing', async () => {
    const spy = recorded();
    const b = await replica('client-b', {}, spy.transport);
    let passes = 0;
    const watch = b.watchSpace({ onPass: () => (passes += 1) });
    await expect.poll(() => passes).toBe(1);
    watch.stop();
    const reads = spy.heads.mock.calls.length;
    watch.kick();
    watch.kick({ full: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(spy.heads.mock.calls.length).toBe(reads);
  });

  it('recovers a head stamped below the cursor on a full kick', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);
    let passes = 0;
    const watch = b.watchSpace({ onPass: () => (passes += 1) });
    await expect.poll(() => b.text(DOC_A)).toBe('alpha. ');
    await expect.poll(() => passes).toBe(1);

    // A transaction that waited past the overlap window commits with the
    // time it started at — below the cursor b already holds.
    await a.edit(DOC_B, 'late. ');
    await a.push(DOC_B);
    await server.backdate(DOC_B, 60 * 60_000);

    watch.kick();
    await expect.poll(() => passes).toBe(2);
    // An ordinary pass reads from the cursor and cannot see it.
    expect(b.has(DOC_B)).toBe(false);

    watch.kick({ full: true });
    await expect.poll(() => passes).toBe(3);
    expect(b.text(DOC_B)).toBe('late. ');
    watch.stop();
  });

  it('reports a failed pass and succeeds on the next kick', async () => {
    let failures = 1;
    const flaky: SyncTransport = {
      ...server,
      heads: (...args) => {
        if (failures-- > 0) return Promise.reject(new Error('server away'));
        return server.heads(...args);
      },
    };
    const a = await replica('client-a');
    const b = await replica('client-b', {}, flaky);
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);

    const errors: unknown[] = [];
    const watch = b.watchSpace({ onError: (e) => errors.push(e) });
    await expect.poll(() => errors).toHaveLength(1);
    watch.kick();
    await expect.poll(() => b.text(DOC_A)).toBe('alpha. ');
    expect(errors).toHaveLength(1);
    expect(await b.headsCursor()).not.toBeNull();
    watch.stop();
  });
});

describe('pulling into a replica', () => {
  let server: ServerStandIn;
  const replicas: SpaceReplica[] = [];

  async function replica(name: string) {
    const r = await createSpaceReplica(name, server);
    replicas.push(r);
    return r;
  }

  beforeEach(async () => {
    server = await createServerStandIn();
  });
  afterEach(async () => {
    await Promise.all(replicas.splice(0).map((r) => r.close()));
    await server.close();
  });

  it('records what it pulled as pushed when nothing of its own was waiting', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');
    // What a device records for a document it has only heard of: known,
    // empty, nothing of its own to send.
    await b.ledger().recordPush(DOC_A, emptyVersion());
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);

    const watch = b.watchSpace();
    await expect.poll(() => b.text(DOC_A)).toBe('alpha. ');
    watch.stop();

    // Sending it back would cost every other device a download of what it
    // already holds.
    expect((await b.push(DOC_A)).pushedSeq).toBeNull();
    expect(await server.updateCount(DOC_A)).toBe(1);
  });

  it('still pushes its own unsent edit after pulling', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');
    await b.ledger().recordPush(DOC_A, emptyVersion());
    await b.edit(DOC_A, 'mine. ');
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);

    const watch = b.watchSpace();
    await expect.poll(() => b.text(DOC_A)).toContain('alpha. ');
    watch.stop();

    expect((await b.push(DOC_A)).pushedSeq).not.toBeNull();
    const watchA = a.watchSpace();
    await expect.poll(() => a.text(DOC_A)).toContain('mine. ');
    watchA.stop();
  });
});
