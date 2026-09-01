import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createServerStandIn,
  type ServerStandIn,
} from './testing/server-stand-in.js';
import { createReplica, DOC_ID, type Replica } from './testing/replica.js';

/**
 * The sync protocol end to end: real Loro documents, real PGlite on both
 * sides, the real engine in between. These reproduce the scenarios the
 * design spike validated — the ones that would each have been a silent data
 * loss had the protocol been wrong.
 *
 * Auth and row-level security are deliberately out of frame: they are
 * enforced by the server schema and covered there. What is under test here
 * is what the client does with an ordered, append-only log.
 */
describe('document sync', () => {
  let server: ServerStandIn;
  const replicas: Replica[] = [];

  async function replica(name: string) {
    const r = await createReplica(name, server);
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

  it('round-trips edits between two replicas', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('Hello from A. ');
    await a.push();
    await b.pull();
    expect(b.text()).toBe('Hello from A. ');
    expect(b.versionHex()).toBe(a.versionHex());

    await b.edit('And B replies. ');
    await b.push();
    await a.pull();
    expect(a.text()).toBe('Hello from A. And B replies. ');
    expect(a.versionHex()).toBe(b.versionHex());
  });

  it('pushes nothing when the ledger already covers the document', async () => {
    const a = await replica('client-a');
    await a.edit('one. ');

    const first = await a.push();
    expect(first.pushedSeq).toBe(1);
    // No local edit in between: the version vector still matches what the
    // server acked, so a second push must not append an empty row.
    const second = await a.push();
    expect(second.pushedSeq).toBeNull();
    expect(await server.updateCount(DOC_ID)).toBe(1);
  });

  it('treats a duplicate delivery of the same blob as a no-op', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('at least once. ');
    await a.push();
    await b.pull();
    const textBefore = b.text();
    const versionBefore = b.versionHex();
    const opsBefore = b.opCount();

    // The same blob delivered a second time — what an ack lost in flight
    // produces when the client retries.
    const rows = await server.tail(DOC_ID, 0);
    await server.resend(DOC_ID, rows[0]!.bytes, 'client-a');
    await b.pull();

    expect(b.text()).toBe(textBefore);
    expect(b.versionHex()).toBe(versionBefore);
    expect(b.opCount()).toBe(opsBefore);
  });

  it('skips its own rows on pull (echo suppression)', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('mine. ');
    await a.push();
    await b.edit('yours. ');
    await b.push();

    const result = await a.pull();
    expect(result.imported).toBe(1); // b's row
    expect(result.skippedOwn).toBe(1); // its own
    expect(a.text()).toContain('yours. ');
  });

  it('converges through a realtime nudge', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    // Poll long enough that only a nudge can explain convergence here.
    const stop = b.watch();
    await waitFor(() => b.text() === '');

    await a.edit('live line. ');
    await a.push();

    await waitFor(() => b.text() === 'live line. ');
    expect(server.nudgeCount()).toBeGreaterThan(0);
    stop();
  });

  it('still converges by polling when every nudge is lost', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    server.dropNudges();
    const stop = b.watch();

    await a.edit('polled through. ');
    await a.push();

    await waitFor(() => b.text() === 'polled through. ');
    expect(server.nudgeCount()).toBe(0);
    stop();
  });

  it('catches up from its watermark after an offline restart', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('seen before going offline. ');
    await a.push();
    await b.pull();

    // B goes offline; A keeps writing.
    await a.edit('offline edit 1. ');
    await a.push();
    await a.edit('offline edit 2. ');
    await a.push();

    // B persists locally and restarts: the document is rebuilt from the
    // local database alone, with no server round-trip.
    await b.snapshotLocally();
    await b.restart();
    expect(b.text()).toBe('seen before going offline. ');

    await b.pull();
    expect(b.text()).toBe(a.text());
    expect(b.versionHex()).toBe(a.versionHex());
  });

  it('makes pulled bytes durable locally before advancing the watermark', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('durable. ');
    await a.push();
    await b.pull();

    // The pulled blob is in B's own journal, so a restart that replays
    // local storage alone still has it — the watermark is past it and it
    // will never be delivered again.
    expect(await b.journalRowCount()).toBeGreaterThan(0);
    const { pulledSeq } = await b.ledger();
    expect(pulledSeq).toBe(1);

    await b.restart();
    expect(b.text()).toBe('durable. ');
  });

  it('serves a fresh checkout from a snapshot after compaction', async () => {
    const a = await replica('client-a');
    let lastSeq = 0;
    for (let i = 0; i < 5; i++) {
      await a.edit(`tail ${String(i)}. `);
      lastSeq = (await a.push()).pushedSeq ?? lastSeq;
    }
    const before = await server.updateCount(DOC_ID);
    expect(before).toBe(5);

    expect(await a.proposeCompaction(lastSeq)).toBe(true);
    expect(await server.updateCount(DOC_ID)).toBe(0);

    // A replica that has never seen this document reconstructs it from the
    // snapshot alone — the log it would otherwise have replayed is gone.
    const c = await replica('client-c');
    await c.pull();
    expect(c.text()).toBe(a.text());
    expect(c.versionHex()).toBe(a.versionHex());
  });

  it('carries full history through compaction', async () => {
    const a = await replica('client-a');
    let lastSeq = 0;
    for (let i = 0; i < 4; i++) {
      await a.edit(`change ${String(i)}. `);
      lastSeq = (await a.push()).pushedSeq ?? lastSeq;
    }
    expect(await a.proposeCompaction(lastSeq)).toBe(true);

    // Snapshots are full exports, never shallow: a fresh checkout must hold
    // every operation, because the server copy is the only history there is.
    const c = await replica('client-c');
    await c.pull();
    expect(c.opCount()).toBe(a.opCount());
  });

  it('preserves a write that lands while a compaction is in flight', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('pre-race. ');
    const coversSeq = (await a.push()).pushedSeq!;

    // B's write lands after A decided its covers_seq but before the RPC
    // runs — it gets a higher seq and must survive the delete.
    await b.pull();
    await b.edit('RACE-SURVIVOR. ');
    const raceSeq = (await b.push()).pushedSeq!;
    expect(raceSeq).toBeGreaterThan(coversSeq);

    expect(await a.proposeCompaction(coversSeq)).toBe(true);
    expect(await server.updateCount(DOC_ID)).toBe(1);

    const d = await replica('client-d');
    await d.pull();
    expect(d.text()).toContain('RACE-SURVIVOR. ');
  });

  it('rejects a stale compaction after a later-covering one landed', async () => {
    const a = await replica('client-a');
    const b = await replica('client-b');

    await a.edit('first. ');
    const seqA = (await a.push()).pushedSeq!;
    await b.pull();
    await b.edit('second. ');
    const seqB = (await b.push()).pushedSeq!;

    expect(await b.proposeCompaction(seqB)).toBe(true);
    // A's proposal covers less than what is already folded in: taking it
    // would move the watermark backwards and drop B's write.
    expect(await a.proposeCompaction(seqA)).toBe(false);

    const head = await server.head(DOC_ID);
    expect(head.snapshotSeq).toBe(seqB);

    const c = await replica('client-c');
    await c.pull();
    expect(c.text()).toContain('second. ');
  });

  it('refuses a compaction covering rows that do not exist yet', async () => {
    const a = await replica('client-a');
    await a.edit('only one row. ');
    const seq = (await a.push()).pushedSeq!;

    // A watermark past the tail would hide every later-arriving row behind it.
    expect(await a.proposeCompaction(seq + 10)).toBe(false);
    expect((await server.head(DOC_ID)).snapshotSeq).toBe(0);
  });

  it('converges four replicas on interleaved writes', async () => {
    const all = await Promise.all(
      ['client-a', 'client-b', 'client-c', 'client-d'].map((n) => replica(n))
    );

    for (let round = 0; round < 3; round++) {
      for (const r of all) {
        await r.pull();
        await r.edit(`${r.name}#${String(round)}. `);
        await r.push();
      }
    }
    // Two passes: the last writer of a round has not been seen by the others.
    for (const r of all) await r.pull();
    for (const r of all) await r.pull();

    const [first, ...rest] = all;
    for (const r of rest) {
      expect(r.text()).toBe(first!.text());
      expect(r.versionHex()).toBe(first!.versionHex());
    }
    expect(first!.text().length).toBeGreaterThan(0);
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not reached before the timeout');
}
