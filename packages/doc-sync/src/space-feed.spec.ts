import { LoroDoc } from 'loro-crdt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpacePassOutcome } from './document-sync.js';
import {
  createServerStandIn,
  type ServerStandIn,
} from './testing/server-stand-in.js';
import { SPACE_ID } from './testing/replica.js';
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
const DOC_A = 'doc_space_spec_000a';
const DOC_B = 'doc_space_spec_000b';
const DOC_C = 'doc_space_spec_000c';
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
    await server.ensureDocument(DOC_A, SPACE_ID);
    await server.ensureDocument(DOC_B, SPACE_ID);
    expect(await server.pushUpdate(DOC_A, blob('a1'), 'w')).toBe(1);
    expect(await server.pushUpdate(DOC_B, blob('b1'), 'w')).toBe(1);
    expect(await server.pushUpdate(DOC_A, blob('a2'), 'w')).toBe(2);
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
    await server.ensureDocument(DOC_A, SPACE_ID);
    await server.pushUpdate(DOC_A, blob('a1'), 'w');
    await server.pushUpdate(DOC_A, blob('a2'), 'w');
    expect(await server.compact(DOC_A, blob('snapshot'), 2)).toBe(true);
    expect(await server.updateCount(DOC_A)).toBe(0);
    expect(await server.pushUpdate(DOC_A, blob('a3'), 'w')).toBe(3);
    const [head] = (await server.heads(SPACE_ID, null, 10, 0)).rows;
    expect(head?.headSeq).toBe(3);
  });

  it('refuses an update for a document that has no row', async () => {
    await expect(
      server.pushUpdate('doc_space_spec_none', blob('x'), 'w')
    ).rejects.toThrow(/not found/);
  });

  it('pages heads oldest first and honours the cursor', async () => {
    for (const id of [DOC_A, DOC_B, DOC_C]) {
      await server.ensureDocument(id, SPACE_ID);
      await server.pushUpdate(id, blob(id), 'w');
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
    expect(outcomes[0]).toEqual({ pulled: 1, skipped: 1 });
    expect(b.text(DOC_A)).toBe('alpha. ');
    expect(b.has(DOC_B)).toBe(false);
    // A head this device has no row for is the materializer's to bring in
    // later; it must not pin every later pass to re-reading the space.
    expect(await b.headsCursor()).not.toBeNull();
    watch.stop();
  });

  it('is prompted by a nudge and inevitable without one', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b', { pollIntervalMs: 25 });
    const watch = b.watchSpace();
    await a.edit(DOC_A, 'one. ');
    await a.push(DOC_A);
    await expect.poll(() => b.text(DOC_A)).toBe('one. ');
    expect(server.spaceNudgeCount()).toBeGreaterThan(0);

    server.dropNudges();
    await a.edit(DOC_A, 'two. ');
    await a.push(DOC_A);
    await expect.poll(() => b.text(DOC_A)).toBe('one. two. ');
    watch.stop();
  });

  it('reports a failed pass and succeeds on the next', async () => {
    let failures = 1;
    const flaky: SyncTransport = {
      ...server,
      heads: (...args) => {
        if (failures-- > 0) return Promise.reject(new Error('server away'));
        return server.heads(...args);
      },
    };
    const a = await replica('client-a');
    const b = await replica('client-b', { pollIntervalMs: 25 }, flaky);
    await a.edit(DOC_A, 'alpha. ');
    await a.push(DOC_A);

    const errors: unknown[] = [];
    const watch = b.watchSpace({ onError: (e) => errors.push(e) });
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
