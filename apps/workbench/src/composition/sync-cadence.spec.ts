import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATCH_UP_ECHO_MS,
  createSyncCadence,
  FULL_PASS_MS,
  HEARTBEAT_DOWN_MS,
  HEARTBEAT_HIDDEN_MS,
  HEARTBEAT_UP_MS,
  PEER_VISIBLE_TTL_MS,
} from './sync-cadence';

/**
 * The cadence table of the leader, row by row, against a fake clock: when
 * the heartbeat runs, when the full pass runs, when a catch-up runs — and
 * that nothing runs in between.
 */

const SECOND = 1_000;

function actions() {
  const heartbeats: { at: number; visible: boolean }[] = [];
  const fullPasses: number[] = [];
  const catchUps: number[] = [];
  const channelLog: { at: number; open: boolean }[] = [];
  return {
    heartbeats,
    fullPasses,
    catchUps,
    channelLog,
    heartbeat: vi.fn(async (input: { visible: boolean }) => {
      heartbeats.push({ at: Date.now(), visible: input.visible });
    }),
    fullPass: vi.fn(() => {
      fullPasses.push(Date.now());
    }),
    catchUp: vi.fn(() => {
      catchUps.push(Date.now());
    }),
    channels: vi.fn((open: boolean) => {
      channelLog.push({ at: Date.now(), open });
    }),
  };
}

const clock = {
  now: () => Date.now(),
  setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimeout: (handle: unknown) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: () => 0.5,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the leader cadence', () => {
  it('names the table it implements', () => {
    expect(HEARTBEAT_UP_MS).toBe(60 * SECOND);
    expect(HEARTBEAT_DOWN_MS).toBe(15 * SECOND);
    expect(HEARTBEAT_HIDDEN_MS).toBe(300 * SECOND);
    expect(FULL_PASS_MS).toBe(300 * SECOND);
    expect(CATCH_UP_ECHO_MS).toBe(5 * SECOND);
    expect(PEER_VISIBLE_TTL_MS).toBe(45 * SECOND);
  });

  it('starts with a catch-up now and again five seconds later', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    expect(a.catchUps).toEqual([0]);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(a.catchUps).toEqual([0, 5 * SECOND]);
    cadence.stop();
  });

  it('visible, channel up: a heartbeat every minute, a full pass every five', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(299 * SECOND);
    expect(a.heartbeats).toEqual([
      { at: 60 * SECOND, visible: true },
      { at: 120 * SECOND, visible: true },
      { at: 180 * SECOND, visible: true },
      { at: 240 * SECOND, visible: true },
    ]);
    expect(a.fullPasses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(a.fullPasses).toEqual([300 * SECOND]);
    expect(a.heartbeats).toHaveLength(5);
    cadence.stop();
  });

  it('visible, channel down: a heartbeat every fifteen seconds', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: false,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(59 * SECOND);
    expect(a.heartbeats.map((beat) => beat.at)).toEqual([
      15 * SECOND,
      30 * SECOND,
      45 * SECOND,
    ]);
    cadence.stop();
  });

  it('no visible tab: a heartbeat every five minutes, without presence, and it is the full pass', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: false,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(299 * SECOND);
    expect(a.heartbeats).toEqual([]);
    expect(a.fullPasses).toEqual([]);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(a.heartbeats).toEqual([{ at: 300 * SECOND, visible: false }]);
    expect(a.fullPasses).toEqual([300 * SECOND]);
    await vi.advanceTimersByTimeAsync(300 * SECOND);
    expect(a.heartbeats.map((beat) => beat.at)).toEqual([
      300 * SECOND,
      600 * SECOND,
    ]);
    expect(a.fullPasses).toEqual([300 * SECOND, 600 * SECOND]);
    cadence.stop();
  });

  it('becoming visible: a catch-up now and five seconds later, and the next heartbeat a minute from then', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: false,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(100 * SECOND);
    a.catchUps.length = 0;

    cadence.setVisible(true);
    expect(a.catchUps).toEqual([100 * SECOND]);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(a.catchUps).toEqual([100 * SECOND, 105 * SECOND]);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(a.heartbeats).toEqual([{ at: 160 * SECOND, visible: true }]);
    cadence.stop();
  });

  it('becoming hidden: the next heartbeat waits out the hidden interval', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(a.heartbeats).toHaveLength(1);
    cadence.setVisible(false);
    await vi.advanceTimersByTimeAsync(299 * SECOND);
    expect(a.heartbeats).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(a.heartbeats.at(-1)).toEqual({ at: 360 * SECOND, visible: false });
    cadence.stop();
  });

  it('the channel coming up: a catch-up now and five seconds later, then the minute heartbeat', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: false,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    a.catchUps.length = 0;
    cadence.setChannelUp(true);
    expect(a.catchUps).toEqual([2 * SECOND]);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(a.catchUps).toEqual([2 * SECOND, 7 * SECOND]);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(a.heartbeats.map((beat) => beat.at)).toEqual([62 * SECOND]);
    cadence.stop();
  });

  it('the channel going down tightens the heartbeat to fifteen seconds', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    a.catchUps.length = 0;
    cadence.setChannelUp(false);
    expect(a.catchUps).toEqual([]);
    await vi.advanceTimersByTimeAsync(24 * SECOND);
    expect(a.heartbeats.map((beat) => beat.at)).toEqual([15 * SECOND]);
    cadence.stop();
  });

  it('a peer visible beat keeps the browser visible for 45 seconds', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: false,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    cadence.peerVisible();
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    cadence.peerVisible();
    // Another tab of this browser is being looked at: the visible cadence.
    await vi.advanceTimersByTimeAsync(20 * SECOND);
    expect(a.heartbeats).toEqual([{ at: 60 * SECOND, visible: true }]);
    // The beats stopped at 40 s: by 85 s the browser counts as hidden.
    await vi.advanceTimersByTimeAsync(240 * SECOND);
    expect(a.heartbeats).toEqual([{ at: 60 * SECOND, visible: true }]);
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(a.heartbeats).toEqual([
      { at: 60 * SECOND, visible: true },
      { at: 360 * SECOND, visible: false },
    ]);
    cadence.stop();
  });

  it('the channels open at start while the browser is visible, and stay closed while it is not', async () => {
    const shown = actions();
    const visible = createSyncCadence(clock, shown, {
      visible: true,
      channelUp: false,
    });
    visible.start();
    expect(shown.channelLog).toEqual([{ at: 0, open: true }]);
    visible.stop();

    const hidden = actions();
    const cadence = createSyncCadence(clock, hidden, {
      visible: false,
      channelUp: false,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    expect(hidden.channelLog).toEqual([{ at: 0, open: false }]);
    cadence.stop();
  });

  it('the channels close only once no tab of the browser is visible, and reopen when one is', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    cadence.peerVisible();
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    // This tab is hidden, but another was looked at 10 s ago: still open.
    cadence.setVisible(false);
    await vi.advanceTimersByTimeAsync(34 * SECOND);
    expect(a.channelLog).toEqual([{ at: 0, open: true }]);
    // The other tab's beat runs out at 45 s: nobody looks any more.
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(a.channelLog).toEqual([
      { at: 0, open: true },
      { at: 45 * SECOND, open: false },
    ]);
    // Another tab is turned to: open again.
    await vi.advanceTimersByTimeAsync(15 * SECOND);
    cadence.peerVisible();
    // This one too: nothing changes for the browser.
    cadence.setVisible(true);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(a.channelLog).toEqual([
      { at: 0, open: true },
      { at: 45 * SECOND, open: false },
      { at: 60 * SECOND, open: true },
    ]);
    cadence.setVisible(false);
    await vi.advanceTimersByTimeAsync(39 * SECOND);
    expect(a.channelLog).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(a.channelLog.at(-1)).toEqual({ at: 105 * SECOND, open: false });
    cadence.stop();
  });

  it('a hidden leader keeps the channels open while another tab keeps being looked at', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: false,
      channelUp: false,
    });
    cadence.start();
    cadence.peerVisible();
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(30 * SECOND);
      cadence.peerVisible();
    }
    expect(a.channelLog).toEqual([
      { at: 0, open: false },
      { at: 0, open: true },
    ]);
    cadence.stop();
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(a.channelLog).toHaveLength(2);
  });

  it('an explicit catch-up runs now and again five seconds later, and leaves the heartbeat where it was', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(20 * SECOND);
    a.catchUps.length = 0;
    cadence.catchUpNow();
    expect(a.catchUps).toEqual([20 * SECOND]);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(a.catchUps).toEqual([20 * SECOND, 25 * SECOND]);
    await vi.advanceTimersByTimeAsync(35 * SECOND);
    expect(a.heartbeats.map((beat) => beat.at)).toEqual([60 * SECOND]);
    cadence.stop();
  });

  it('a peer visible beat alone never catches up', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: false,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    a.catchUps.length = 0;
    cadence.peerVisible();
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    cadence.peerVisible();
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(a.catchUps).toEqual([]);
    cadence.stop();
  });

  it('a rejecting heartbeat does not stop the clock', async () => {
    const a = actions();
    a.heartbeat.mockRejectedValueOnce(new Error('probe failed'));
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(a.heartbeat).toHaveBeenCalledTimes(2);
    cadence.stop();
  });

  it('a slow heartbeat never overlaps the next one', async () => {
    const a = actions();
    let finish!: () => void;
    a.heartbeat.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    await vi.advanceTimersByTimeAsync(120 * SECOND);
    expect(a.heartbeat).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(a.heartbeat).toHaveBeenCalledTimes(2);
    cadence.stop();
  });

  it('runs nothing once stopped', async () => {
    const a = actions();
    const cadence = createSyncCadence(clock, a, {
      visible: true,
      channelUp: true,
    });
    cadence.start();
    cadence.stop();
    cadence.setVisible(true);
    cadence.setChannelUp(false);
    cadence.peerVisible();
    await vi.advanceTimersByTimeAsync(600 * SECOND);
    expect(a.heartbeat).not.toHaveBeenCalled();
    expect(a.fullPass).not.toHaveBeenCalled();
    expect(a.catchUps).toEqual([0]);
  });
});
