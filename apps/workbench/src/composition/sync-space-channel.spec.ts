import { entityIdRegistry } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRealtimeSyncChannels,
  type SpaceSignalKind,
} from './sync-channels';
import {
  createSpaceChannel,
  REJOIN_BACKOFF_MAX_MS,
  REJOIN_BACKOFF_MIN_MS,
  REKEY_JITTER_MS,
  SIGNAL_FOLLOW_UP_MIN_MS,
} from './sync-space-channel';
import { fakeRealtimeClient, fakeSyncChannels } from './testing/sync-fakes';

/**
 * The leader's hold on its space's signal channel, against a fake clock, a
 * seeded random and a fake channel seam: which topic it joins, when a
 * signal turns into kicks, how it follows the topic to a new epoch, and how
 * it comes back after the channel drops.
 */

const SECOND = 1_000;
const SPACE = entityIdRegistry.factories.spaceIdFactory.brand(
  'spc_0000000000000001.0000000000'
);
const topic = (epoch: number) => `space:${SPACE}:${epoch}`;

function harness(
  options: {
    random?: number[];
    epochs?: number[];
  } = {}
) {
  const randoms = [...(options.random ?? [])];
  const epochs = [...(options.epochs ?? [0])];
  const fake = fakeSyncChannels();
  const kicks: { at: number; kind: SpaceSignalKind }[] = [];
  const events: string[] = [];
  const epoch = vi.fn(async (_options: { fresh: boolean }) => {
    const next = epochs.length > 1 ? epochs.shift()! : epochs[0]!;
    return next;
  });
  const channel = createSpaceChannel({
    channels: fake.channels,
    clock: {
      now: () => Date.now(),
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
      random: () => (randoms.length > 0 ? randoms.shift()! : 0),
    },
    spaceId: SPACE,
    epoch,
    onKick: (kind) => kicks.push({ at: Date.now(), kind }),
    onUp: ({ epoch: joined }) => events.push(`up ${joined}`),
    onDown: () => events.push('down'),
  });
  return { fake, channel, kicks, events, epoch };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the space signal channel', () => {
  it('names its timings', () => {
    expect(SIGNAL_FOLLOW_UP_MIN_MS).toBe(5 * SECOND);
    expect(REKEY_JITTER_MS).toBe(5 * SECOND);
    expect(REJOIN_BACKOFF_MIN_MS).toBe(1 * SECOND);
    expect(REJOIN_BACKOFF_MAX_MS).toBe(60 * SECOND);
  });

  it('joins the topic of the epoch the probe states, once however often it is opened', async () => {
    const h = harness({ epochs: [4] });
    h.channel.open();
    h.channel.open();
    await flush();
    expect(h.fake.joins.map((join) => join.topic)).toEqual([topic(4)]);
    expect(h.epoch).toHaveBeenCalledWith({ fresh: false });
    expect(h.events).toEqual([]);
    h.fake.last()!.handlers.onSubscribed();
    expect(h.events).toEqual(['up 4']);
    h.channel.close();
  });

  it('a change signal kicks its kind after a random part of half the window, and again after the window or 5 s', async () => {
    for (const [random, delay] of [
      [0, 0],
      [0.5, 2 * SECOND],
      [1, 4 * SECOND],
    ] as const) {
      vi.setSystemTime(0);
      const h = harness({ random: [random] });
      h.channel.open();
      await flush();
      h.fake.last()!.handlers.onSubscribed();
      h.fake.last()!.handlers.onSignal({ kind: 'graph', windowMs: 8 * SECOND });
      await vi.advanceTimersByTimeAsync(20 * SECOND);
      expect(h.kicks).toEqual([
        { at: delay, kind: 'graph' },
        { at: 8 * SECOND, kind: 'graph' },
      ]);
      h.channel.close();
    }
  });

  it('a short window is followed up after five seconds, not sooner', async () => {
    const h = harness({ random: [0.5] });
    h.channel.open();
    await flush();
    h.fake.last()!.handlers.onSignal({ kind: 'documents', windowMs: 1000 });
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(h.kicks).toEqual([
      { at: 250, kind: 'documents' },
      { at: 5 * SECOND, kind: 'documents' },
    ]);
    h.channel.close();
  });

  it('signals close together: a kick each unless one is pending, and one follow-up after the last', async () => {
    const h = harness({ random: [0.5, 0.5, 0.5] });
    h.channel.open();
    await flush();
    const signal = () =>
      h.fake.last()!.handlers.onSignal({ kind: 'graph', windowMs: 1000 });
    signal();
    await vi.advanceTimersByTimeAsync(100);
    // A kick is still pending: the second signal adds none of its own.
    signal();
    await vi.advanceTimersByTimeAsync(500);
    signal();
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(h.kicks).toEqual([
      { at: 250, kind: 'graph' },
      { at: 850, kind: 'graph' },
      { at: 600 + 5 * SECOND, kind: 'graph' },
    ]);
    h.channel.close();
  });

  it('kinds are kicked independently', async () => {
    const h = harness({ random: [0, 0] });
    h.channel.open();
    await flush();
    h.fake.last()!.handlers.onSignal({ kind: 'graph-delete', windowMs: 1000 });
    h.fake.last()!.handlers.onSignal({ kind: 'documents', windowMs: 1000 });
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(h.kicks.map((kick) => `${kick.at} ${kick.kind}`).sort()).toEqual(
      [
        '0 graph-delete',
        '0 documents',
        '5000 graph-delete',
        '5000 documents',
      ].sort()
    );
    h.channel.close();
  });

  it('a rekey leaves the topic and joins the new epoch after a random part of 5 s; the channel is down meanwhile', async () => {
    const h = harness({ random: [0.4] });
    h.channel.open();
    await flush();
    const first = h.fake.last()!;
    first.handlers.onSubscribed();
    first.handlers.onRekey({ epoch: 1 });
    expect(first.left).toBe(true);
    expect(h.events).toEqual(['up 0', 'down']);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.fake.joins).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fake.joins.map((join) => join.topic)).toEqual([
      topic(0),
      topic(1),
    ]);
    // The epoch came with the rekey: nothing was asked of the probe.
    expect(h.epoch).toHaveBeenCalledTimes(1);
    // Subscribed again: up, which is when the composition catches up.
    h.fake.last()!.handlers.onSubscribed();
    expect(h.events).toEqual(['up 0', 'down', 'up 1']);
    h.channel.close();
  });

  it('a rekey to an epoch it is already past is ignored', async () => {
    const h = harness({ epochs: [2] });
    h.channel.open();
    await flush();
    h.fake.last()!.handlers.onSubscribed();
    h.fake.last()!.handlers.onRekey({ epoch: 2 });
    h.fake.last()!.handlers.onRekey({ epoch: 1 });
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(h.fake.joins).toHaveLength(1);
    expect(h.fake.last()!.left).toBe(false);
    h.channel.close();
  });

  it('a probe that sees a newer epoch moves the channel as a rekey would', async () => {
    const h = harness({ random: [0] });
    h.channel.open();
    await flush();
    h.fake.last()!.handlers.onSubscribed();
    h.channel.epochSeen(0);
    await flush();
    expect(h.fake.joins).toHaveLength(1);
    h.channel.epochSeen(3);
    await flush();
    expect(h.fake.joins.map((join) => join.topic)).toEqual([
      topic(0),
      topic(3),
    ]);
    h.channel.close();
  });

  it('a refused join reads the epoch afresh, then joins again after the backoff', async () => {
    const h = harness({ epochs: [0, 2] });
    h.channel.open();
    await flush();
    h.fake.last()!.handlers.onDown('refused');
    expect(h.fake.last()!.left).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.fake.joins).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.epoch.mock.calls).toEqual([[{ fresh: false }], [{ fresh: true }]]);
    expect(h.fake.joins.map((join) => join.topic)).toEqual([
      topic(0),
      topic(2),
    ]);
    h.channel.close();
  });

  it('a dropped channel reconnects at 1, 2, 4 … 60 s, and a subscription starts the count again', async () => {
    const h = harness();
    h.channel.open();
    await flush();
    h.fake.last()!.handlers.onSubscribed();
    const joinedAt: number[] = [];
    for (let i = 0; i < 8; i++) {
      const joins = h.fake.joins.length;
      h.fake.last()!.handlers.onDown(i % 2 === 0 ? 'error' : 'timeout');
      while (h.fake.joins.length === joins)
        await vi.advanceTimersByTimeAsync(100);
      joinedAt.push(Date.now());
    }
    const gaps = joinedAt.map((at, i) => at - (i === 0 ? 0 : joinedAt[i - 1]!));
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    expect(h.events).toEqual(['up 0', 'down']);
    h.fake.last()!.handlers.onSubscribed();
    const before = Date.now();
    h.fake.last()!.handlers.onDown('closed');
    const joins = h.fake.joins.length;
    while (h.fake.joins.length === joins)
      await vi.advanceTimersByTimeAsync(100);
    expect(Date.now() - before).toBe(1000);
    expect(h.events).toEqual(['up 0', 'down', 'up 0', 'down']);
    h.channel.close();
  });

  it('an epoch that cannot be read is tried again with the backoff', async () => {
    const h = harness();
    h.epoch.mockRejectedValueOnce(new Error('change probe failed'));
    h.channel.open();
    await flush();
    expect(h.fake.joins).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.fake.joins.map((join) => join.topic)).toEqual([topic(0)]);
    h.channel.close();
  });

  it('closing leaves, cancels every pending kick, follow-up and rejoin, and says the channel is down', async () => {
    const h = harness({ random: [0.5] });
    h.channel.open();
    await flush();
    const first = h.fake.last()!;
    first.handlers.onSubscribed();
    first.handlers.onSignal({ kind: 'graph', windowMs: 8 * SECOND });
    h.channel.close();
    expect(first.left).toBe(true);
    expect(h.events).toEqual(['up 0', 'down']);
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(h.kicks).toEqual([]);
    expect(h.fake.joins).toHaveLength(1);

    // Reopened: a fresh join of the current epoch.
    h.channel.open();
    await flush();
    expect(h.fake.joins).toHaveLength(2);
    const second = h.fake.last()!;
    second.handlers.onDown('error');
    h.channel.close();
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(h.fake.joins).toHaveLength(2);
  });

  it('a close while the epoch is being read joins nothing afterwards', async () => {
    const h = harness();
    let resolve!: (epoch: number) => void;
    h.epoch.mockImplementationOnce(
      () => new Promise<number>((r) => (resolve = r))
    );
    h.channel.open();
    h.channel.close();
    resolve(0);
    await flush();
    expect(h.fake.joins).toHaveLength(0);
  });

  it('a quick close and reopen still joins: the reopen waits for the removal, hears signals, and recovers from a drop', async () => {
    const f = fakeRealtimeClient({ leaveMs: 200 });
    const kicks: SpaceSignalKind[] = [];
    const events: string[] = [];
    const channel = createSpaceChannel({
      channels: createRealtimeSyncChannels(f.client),
      clock: {
        now: () => Date.now(),
        setTimeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
        random: () => 0,
      },
      spaceId: SPACE,
      epoch: async () => 0,
      onKick: (kind) => kicks.push(kind),
      onUp: ({ epoch }) => events.push(`up ${epoch}`),
      onDown: () => events.push('down'),
    });
    channel.open();
    await flush();
    f.created[0]!.accept();
    expect(events).toEqual(['up 0']);

    // Hidden and shown again before the first channel is gone.
    channel.close();
    channel.open();
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    expect(f.created).toHaveLength(2);
    f.created[1]!.accept();
    expect(events).toEqual(['up 0', 'down', 'up 0']);

    f.created[1]!.deliver('changed', { kind: 'graph', window_ms: 1000 });
    await flush();
    expect(kicks).toEqual(['graph']);

    // A drop after that is noticed and retried as ever.
    f.created[1]!.fail();
    expect(events.at(-1)).toBe('down');
    await vi.advanceTimersByTimeAsync(1200);
    expect(f.created).toHaveLength(3);
    f.created[2]!.accept();
    expect(events.at(-1)).toBe('up 0');
    channel.close();
  });
});
