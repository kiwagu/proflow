import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import { entityIdRegistry } from '@workspace/entity-id';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRealtimeSyncChannels,
  type SpaceChannelHandlers,
  spaceTopic,
} from './sync-channels';
import { fakeRealtimeClient } from './testing/sync-fakes';

/**
 * The one place the workbench speaks Realtime: what a join asks for, what
 * of an incoming message is believed, and what each channel state means to
 * the rest of the composition. The client is a recording fake shaped like
 * supabase-js's channel API.
 */

type Listener = (message: { payload?: unknown }) => void;
type StatusCallback = (status: string, error?: Error) => void;

function fakeClient() {
  const opened: {
    topic: string;
    options: unknown;
    listeners: Map<string, Listener>;
    bindings: { type: string; event: string }[];
    report(status: string, error?: Error): void;
    deliver(event: string, payload: unknown): void;
  }[] = [];
  const removeChannel = vi.fn(async (_channel: unknown) => 'ok' as const);
  const client = {
    channel: vi.fn((topic: string, options: unknown) => {
      let status: StatusCallback | undefined;
      const listeners = new Map<string, Listener>();
      const bindings: { type: string; event: string }[] = [];
      const channel = {
        on(type: string, filter: { event: string }, listener: Listener) {
          bindings.push({ type, event: filter.event });
          listeners.set(filter.event, listener);
          return channel;
        },
        subscribe(callback: StatusCallback) {
          status = callback;
          return channel;
        },
      };
      opened.push({
        topic,
        options,
        listeners,
        bindings,
        report: (s, error) => status?.(s, error),
        deliver: (event, payload) => listeners.get(event)?.({ payload }),
      });
      return channel;
    }),
    removeChannel,
  };
  return {
    client: client as unknown as SupabaseClient<Database>,
    channel: client.channel,
    removeChannel,
    opened,
  };
}

function recorder(): SpaceChannelHandlers & {
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  return {
    calls,
    onSignal: (signal) => calls.push(['signal', signal]),
    onRekey: (next) => calls.push(['rekey', next]),
    onSubscribed: () => calls.push(['subscribed']),
    onDown: (reason) => calls.push(['down', reason]),
  };
}

const SPACE = entityIdRegistry.factories.spaceIdFactory.brand(
  'spc_0000000000000001.0000000000'
);
const TOPIC = `space:${SPACE}:0`;

describe('the space topic', () => {
  it('is named after the space and its epoch', () => {
    expect(spaceTopic(SPACE, 0)).toBe(TOPIC);
    expect(spaceTopic(SPACE, 7)).toBe(`space:${SPACE}:7`);
  });
});

describe('joining a space over Realtime', () => {
  it('joins the topic as a private channel, listening for changed and rekey broadcasts only', () => {
    const f = fakeClient();
    const channels = createRealtimeSyncChannels(f.client);
    const leave = channels.joinSpace(TOPIC, recorder());
    expect(f.channel).toHaveBeenCalledTimes(1);
    expect(f.opened[0]?.topic).toBe(TOPIC);
    expect(f.opened[0]?.options).toEqual({ config: { private: true } });
    expect(f.opened[0]?.bindings).toEqual([
      { type: 'broadcast', event: 'changed' },
      { type: 'broadcast', event: 'rekey' },
    ]);
    leave();
  });

  it('hands a change signal on in its own words, and ignores what else the server added', () => {
    const f = fakeClient();
    const h = recorder();
    const leave = createRealtimeSyncChannels(f.client).joinSpace(TOPIC, h);
    f.opened[0]!.deliver('changed', {
      kind: 'graph-delete',
      window_ms: 5000,
      id: '1b0e7a8e-3a43-4a0c-8a5c-0f1f0b0c0d0e',
    });
    expect(h.calls).toEqual([
      ['signal', { kind: 'graph-delete', windowMs: 5000 }],
    ]);
    leave();
  });

  it('drops a signal it cannot read: nothing is kicked by a malformed message', () => {
    const f = fakeClient();
    const h = recorder();
    const leave = createRealtimeSyncChannels(f.client).joinSpace(TOPIC, h);
    for (const payload of [
      { kind: 'rows', window_ms: 1000 },
      { kind: 'graph', window_ms: 0 },
      { kind: 'graph', window_ms: -1 },
      { kind: 'graph', window_ms: 1.5 },
      { kind: 'graph', window_ms: '1000' },
      { kind: 'graph' },
      { window_ms: 1000 },
      null,
      'graph',
    ])
      f.opened[0]!.deliver('changed', payload);
    expect(h.calls).toEqual([]);
    leave();
  });

  it('hands a rekey on with its epoch, and drops one it cannot read', () => {
    const f = fakeClient();
    const h = recorder();
    const leave = createRealtimeSyncChannels(f.client).joinSpace(TOPIC, h);
    f.opened[0]!.deliver('rekey', { epoch: 3 });
    for (const payload of [{ epoch: -1 }, { epoch: 'x' }, { epoch: 1.5 }, {}])
      f.opened[0]!.deliver('rekey', payload);
    expect(h.calls).toEqual([['rekey', { epoch: 3 }]]);
    leave();
  });

  it('says what each channel state means', () => {
    const f = fakeClient();
    const h = recorder();
    const leave = createRealtimeSyncChannels(f.client).joinSpace(TOPIC, h);
    const report = f.opened[0]!.report;
    report('SUBSCRIBED');
    report(
      'CHANNEL_ERROR',
      new Error(
        `Unauthorized: You do not have permissions to read from this Channel topic: ${TOPIC}`
      )
    );
    report('CHANNEL_ERROR', new Error('socket closed: 1006'));
    report('CHANNEL_ERROR');
    report('TIMED_OUT');
    report('CLOSED');
    expect(h.calls).toEqual([
      ['subscribed'],
      ['down', 'refused'],
      ['down', 'error'],
      ['down', 'error'],
      ['down', 'timeout'],
      ['down', 'closed'],
    ]);
    leave();
  });

  it('leaving removes the channel once, and nothing it says afterwards is heard', () => {
    const f = fakeClient();
    const h = recorder();
    const leave = createRealtimeSyncChannels(f.client).joinSpace(TOPIC, h);
    leave();
    leave();
    expect(f.removeChannel).toHaveBeenCalledTimes(1);
    f.opened[0]!.report('CLOSED');
    f.opened[0]!.deliver('changed', { kind: 'graph', window_ms: 1000 });
    expect(h.calls).toEqual([]);
  });
});

describe('leaving a topic and joining it again', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a join while the topic is still being left waits for the removal, then hears the server on a fresh channel', async () => {
    const f = fakeRealtimeClient({ leaveMs: 200 });
    const channels = createRealtimeSyncChannels(f.client);
    const first = recorder();
    const leaveFirst = channels.joinSpace(TOPIC, first);
    f.created[0]!.accept();
    const left = leaveFirst();
    const second = recorder();
    const leaveSecond = channels.joinSpace(TOPIC, second);
    await vi.advanceTimersByTimeAsync(199);
    // Still being left: no second join on the closing channel.
    expect(f.created).toHaveLength(1);
    expect(f.created[0]!.state).toBe('leaving');
    await vi.advanceTimersByTimeAsync(1);
    await left;
    expect(f.created).toHaveLength(2);
    expect(f.created[1]!.state).toBe('joining');
    f.created[1]!.accept();
    f.created[1]!.deliver('changed', { kind: 'graph', window_ms: 1000 });
    expect(second.calls).toEqual([
      ['subscribed'],
      ['signal', { kind: 'graph', windowMs: 1000 }],
    ]);
    expect(first.calls).toEqual([['subscribed']]);
    const gone = leaveSecond();
    await vi.advanceTimersByTimeAsync(200);
    await gone;
    expect(f.held(TOPIC)).toBeUndefined();
  });

  it('a queued join left before it was made opens nothing', async () => {
    const f = fakeRealtimeClient({ leaveMs: 200 });
    const channels = createRealtimeSyncChannels(f.client);
    const leaveFirst = channels.joinSpace(TOPIC, recorder());
    f.created[0]!.accept();
    void leaveFirst();
    const second = recorder();
    const leaveSecond = channels.joinSpace(TOPIC, second);
    void leaveSecond();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.created).toHaveLength(1);
    expect(f.held(TOPIC)).toBeUndefined();
    expect(second.calls).toEqual([]);
  });
});
