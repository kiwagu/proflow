import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import type { SpaceChannelHandlers, SyncChannels } from '../sync-channels';

/**
 * In-memory stand-ins for the two browser primitives the sync composition
 * coordinates tabs with: Web Locks and BroadcastChannel. Each behaves the
 * way the browser documents it for the parts the composition relies on —
 * one holder per lock name with a queue behind it, and a channel that
 * delivers to every OTHER member of the same name, asynchronously.
 */

type Waiter = {
  callback: (lock: Lock | null) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export interface FakeLocks extends LockManager {
  /** Whether a tab holds the lock of this name right now. */
  held(name: string): boolean;
}

export function fakeLocks(): FakeLocks {
  const queues = new Map<string, Waiter[]>();
  const holding = new Set<string>();

  const next = (name: string) => {
    if (holding.has(name)) return;
    const waiter = queues.get(name)?.shift();
    if (!waiter) return;
    holding.add(name);
    Promise.resolve()
      .then(() => waiter.callback({ name, mode: 'exclusive' } as Lock))
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        holding.delete(name);
        next(name);
      });
  };

  const request = (
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock | null) => unknown),
    maybeCallback?: (lock: Lock | null) => unknown
  ) =>
    new Promise((resolve, reject) => {
      const options =
        typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
      const callback =
        typeof optionsOrCallback === 'function'
          ? optionsOrCallback
          : maybeCallback!;
      const waiter: Waiter = { callback, resolve, reject };
      const queue = queues.get(name) ?? [];
      queues.set(name, queue);
      queue.push(waiter);
      options.signal?.addEventListener('abort', () => {
        const index = queue.indexOf(waiter);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(new DOMException('The request was aborted.', 'AbortError'));
      });
      next(name);
    });

  return {
    request,
    query: async () => ({ held: [], pending: [] }),
    held: (name: string) => holding.has(name),
  } as unknown as FakeLocks;
}

/** A set of channels of one name: what one browser's tabs share. */
export function fakeChannelBus() {
  const members = new Set<FakeChannel>();

  class FakeChannel extends EventTarget {
    closed = false;
    constructor(readonly name: string) {
      super();
      members.add(this);
    }
    postMessage(data: unknown) {
      if (this.closed) return;
      for (const member of members) {
        if (member === this || member.closed) continue;
        queueMicrotask(() => {
          if (!member.closed)
            member.dispatchEvent(new MessageEvent('message', { data }));
        });
      }
    }
    close() {
      this.closed = true;
      members.delete(this);
    }
  }

  return {
    /** One tab's end of the channel. */
    open: (name = 'bus') =>
      new FakeChannel(name) as unknown as BroadcastChannel,
  };
}

/** One join of a space topic, as the fake channels recorded it. */
export interface FakeSpaceJoin {
  topic: string;
  handlers: SpaceChannelHandlers;
  left: boolean;
}

/**
 * The channel seam with no network behind it: every join is recorded, and
 * the test speaks for the server through the join's handlers. A left join
 * hears nothing more, as the real seam promises.
 */
export function fakeSyncChannels() {
  const joins: FakeSpaceJoin[] = [];
  const channels: SyncChannels = {
    joinSpace(topic, handlers) {
      const join: FakeSpaceJoin = {
        topic,
        left: false,
        handlers: {
          onSignal: (signal) => !join.left && handlers.onSignal(signal),
          onRekey: (next) => !join.left && handlers.onRekey(next),
          onSubscribed: () => !join.left && handlers.onSubscribed(),
          onDown: (reason) => !join.left && handlers.onDown(reason),
        },
      };
      joins.push(join);
      return () => {
        join.left = true;
        return Promise.resolve();
      };
    },
  };
  return {
    channels,
    joins,
    /** The join still open, if any. */
    live: () => joins.filter((join) => !join.left),
    /** The last join made. */
    last: () => joins[joins.length - 1],
  };
}

type RealtimeListener = (message: { payload?: unknown }) => void;
type RealtimeStatus = (status: string, error?: Error) => void;

/** One channel object of the fake Realtime client, with the server's side. */
export interface FakeRealtimeChannel {
  topic: string;
  state: 'closed' | 'joining' | 'joined' | 'errored' | 'leaving';
  /** The server accepted the join. */
  accept(): void;
  /** The connection failed under the channel. */
  fail(error?: Error): void;
  /** The database broadcast this on the channel's topic. */
  deliver(event: string, payload: unknown): void;
}

/**
 * A Realtime client shaped by the parts of supabase-js the seam relies on,
 * down to the two that make a quick close and reopen hard: `channel(topic)`
 * hands back the object it already holds for that topic until the removal
 * of that object has finished, and `subscribe(callback)` on an object that
 * is not closed does nothing at all. A removal finishes `leaveMs` later, as
 * the next of `removals` says: `ok` closes the channel; `error` and `reject`
 * leave it held and leaving (answering 'error', or rejecting); `hang` closes
 * it but never answers.
 */
export function fakeRealtimeClient(options: {
  leaveMs: number;
  removals?: ('ok' | 'error' | 'reject' | 'hang')[];
}) {
  const removals = [...(options.removals ?? [])];
  const registry = new Map<string, FakeRealtimeChannel>();
  const created: FakeRealtimeChannel[] = [];

  function open(topic: string) {
    const listeners = new Map<string, RealtimeListener[]>();
    let status: RealtimeStatus | undefined;
    const channel = {
      topic,
      state: 'closed' as FakeRealtimeChannel['state'],
      on(_type: string, filter: { event: string }, listener: RealtimeListener) {
        listeners.set(filter.event, [
          ...(listeners.get(filter.event) ?? []),
          listener,
        ]);
        return channel;
      },
      subscribe(callback: RealtimeStatus) {
        if (channel.state !== 'closed') return channel;
        channel.state = 'joining';
        status = callback;
        return channel;
      },
      accept() {
        if (channel.state !== 'joining') return;
        channel.state = 'joined';
        status?.('SUBSCRIBED');
      },
      fail(error = new Error('socket closed: 1006')) {
        channel.state = 'errored';
        status?.('CHANNEL_ERROR', error);
      },
      deliver(event: string, payload: unknown) {
        if (channel.state !== 'joined') return;
        for (const listener of listeners.get(event) ?? [])
          listener({ payload });
      },
      close() {
        channel.state = 'closed';
        status?.('CLOSED');
        if (registry.get(topic) === channel) registry.delete(topic);
      },
    };
    return channel;
  }

  const client = {
    channel(topic: string, _options?: unknown) {
      const held = registry.get(topic);
      if (held) return held;
      const channel = open(topic);
      registry.set(topic, channel);
      created.push(channel);
      return channel;
    },
    removeChannel(channel: ReturnType<typeof open>) {
      channel.state = 'leaving';
      const outcome = removals.shift() ?? 'ok';
      return new Promise<'ok' | 'error'>((resolve, reject) =>
        setTimeout(() => {
          if (outcome === 'error') resolve('error');
          else if (outcome === 'reject') reject(new Error('leave failed'));
          else {
            channel.close();
            if (outcome === 'ok') resolve('ok');
          }
        }, options.leaveMs)
      );
    },
  };
  return {
    client: client as unknown as SupabaseClient<Database>,
    /** Every channel object made, in order. */
    created,
    /** The object the client holds for a topic now, if any. */
    held: (topic: string) => registry.get(topic),
  };
}
