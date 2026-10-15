import type { SpaceId } from '@workspace/entity-id';
import type { CadenceClock } from './sync-cadence';
import {
  type ChannelDownReason,
  type SpaceSignal,
  type SpaceSignalKind,
  spaceTopic,
  type SyncChannels,
} from './sync-channels';

/**
 * The leader's hold on its space's signal channel: which topic it joins,
 * what a signal turns into, and how it gets the channel back.
 *
 * A signal is a kick, never a delivery. Every listener of a space hears it
 * at once, so the kick waits a random part of half the throttle window the
 * server stated, which spreads the pulls of a thousand browsers over that
 * half window instead of landing them in one instant; it is kicked once more
 * a window later (at least 5 s), which picks up what the server's throttle
 * kept silent after the first change and what committed late. A second
 * signal while a kick of its kind is still waiting adds no kick of its own,
 * and moves the follow-up after itself.
 *
 * The topic carries the space's epoch, which the change probe states. A
 * `rekey` names the next one: the channel leaves, and joins the new topic
 * after a random part of 5 s, so a whole space does not rejoin in one
 * instant. A probe that sees a newer epoch than the joined one does the
 * same, for a rekey that was missed. A join the server refuses (a stale
 * epoch, or no longer a member) reads the epoch afresh before it tries
 * again; any other drop tries again as it was. Retries back off from 1 s to
 * a minute and start over once a join holds.
 *
 * Up and down are said only when they change: up when a join is
 * subscribed, down when it drops, is rekeyed or is closed.
 */

export const SIGNAL_FOLLOW_UP_MIN_MS = 5_000;
export const REKEY_JITTER_MS = 5_000;
export const REJOIN_BACKOFF_MIN_MS = 1_000;
export const REJOIN_BACKOFF_MAX_MS = 60_000;

export interface SpaceChannel {
  /** Join the space's current topic, unless already open. */
  open(): void;
  /** Leave, and cancel everything still pending. */
  close(): void;
  /** The change probe answered with this epoch. */
  epochSeen(epoch: number): void;
}

export function createSpaceChannel(deps: {
  channels: SyncChannels;
  clock: CadenceClock;
  spaceId: SpaceId;
  /**
   * The space's current epoch, from the change probe: the last answer
   * unless `fresh` asks for a new one.
   */
  epoch(options: { fresh: boolean }): Promise<number>;
  onKick(kind: SpaceSignalKind): void;
  /** A join holds: signals of the space reach this browser. */
  onUp(joined: { epoch: number }): void;
  /** The channel is not delivering any more. */
  onDown(): void;
  /** Every signal heard, before its kicks are scheduled. */
  onSignal?(signal: SpaceSignal): void;
}): SpaceChannel {
  const { clock } = deps;
  let opened = false;
  /** Bumped by every new intent; what an older one scheduled is void. */
  let generation = 0;
  /**
   * Leaves the joined topic. The seam holds a later join of the same topic
   * until the leave is through, so nothing here waits for it.
   */
  let leave: (() => Promise<void>) | null = null;
  let up = false;
  /** The epoch of the topic joined or being joined. */
  let joined: number | null = null;
  let attempts = 0;
  let retryTimer: unknown = null;
  const kickTimers = new Map<SpaceSignalKind, unknown>();
  const followUps = new Map<SpaceSignalKind, unknown>();

  const clear = (handle: unknown) => {
    if (handle !== null && handle !== undefined) clock.clearTimeout(handle);
  };

  const setUp = (next: boolean) => {
    if (next === up) return;
    up = next;
    if (next) deps.onUp({ epoch: joined! });
    else deps.onDown();
  };

  const drop = () => {
    void leave?.();
    leave = null;
  };

  const kickLater = (kind: SpaceSignalKind, windowMs: number) => {
    if (!kickTimers.has(kind))
      kickTimers.set(
        kind,
        clock.setTimeout(
          () => {
            kickTimers.delete(kind);
            deps.onKick(kind);
          },
          (clock.random() * windowMs) / 2
        )
      );
    clear(followUps.get(kind));
    followUps.set(
      kind,
      clock.setTimeout(
        () => {
          followUps.delete(kind);
          deps.onKick(kind);
        },
        Math.max(windowMs, SIGNAL_FOLLOW_UP_MIN_MS)
      )
    );
  };

  const join = (epoch: number) => {
    drop();
    joined = epoch;
    const token = generation;
    const current = () => token === generation;
    leave = deps.channels.joinSpace(spaceTopic(deps.spaceId, epoch), {
      onSubscribed: () => {
        if (!current()) return;
        attempts = 0;
        setUp(true);
      },
      onDown: (reason) => {
        if (current()) down(reason);
      },
      onSignal: (signal) => {
        if (!current()) return;
        deps.onSignal?.(signal);
        kickLater(signal.kind, signal.windowMs);
      },
      onRekey: ({ epoch: next }) => {
        if (current()) rekey(next);
      },
    });
  };

  /** Read the epoch, then join its topic; an unreadable epoch is retried. */
  const connect = (fresh: boolean) => {
    const token = ++generation;
    deps.epoch({ fresh }).then(
      (epoch) => {
        if (opened && token === generation) join(epoch);
      },
      () => {
        if (opened && token === generation) retry(fresh);
      }
    );
  };

  const retry = (fresh: boolean) => {
    clear(retryTimer);
    const token = generation;
    const delay = Math.min(
      REJOIN_BACKOFF_MIN_MS * 2 ** attempts,
      REJOIN_BACKOFF_MAX_MS
    );
    attempts += 1;
    retryTimer = clock.setTimeout(() => {
      retryTimer = null;
      if (opened && token === generation) connect(fresh);
    }, delay);
  };

  function down(reason: ChannelDownReason) {
    drop();
    setUp(false);
    retry(reason === 'refused');
  }

  function rekey(next: number) {
    if (joined !== null && next <= joined) return;
    drop();
    setUp(false);
    clear(retryTimer);
    attempts = 0;
    joined = next;
    const token = ++generation;
    retryTimer = clock.setTimeout(() => {
      retryTimer = null;
      if (opened && token === generation) join(next);
    }, clock.random() * REKEY_JITTER_MS);
  }

  return {
    open() {
      if (opened) return;
      opened = true;
      attempts = 0;
      connect(false);
    },
    close() {
      if (!opened) return;
      opened = false;
      generation += 1;
      drop();
      clear(retryTimer);
      retryTimer = null;
      for (const handle of [...kickTimers.values(), ...followUps.values()])
        clear(handle);
      kickTimers.clear();
      followUps.clear();
      attempts = 0;
      setUp(false);
    },
    epochSeen(epoch) {
      if (opened && joined !== null && epoch > joined) rekey(epoch);
    },
  };
}
