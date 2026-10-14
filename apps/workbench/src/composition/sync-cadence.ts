/**
 * When the leader tab of a browser asks the server anything, as one small
 * state machine over an injected clock.
 *
 * The engines keep no clock of their own; this decides when their cycles
 * are worth running. Three actions, three triggers:
 *
 *   heartbeat  the change probe (and the presence beat while someone looks
 *              at the space): every minute while a tab of this browser is
 *              visible and the nudge channel is up, every 15 s while the
 *              channel is down (nudges cannot arrive, so the probe is what
 *              keeps the space fresh), every 5 min while no tab is visible.
 *   full pass  every table pulled with an inventory sweep, every head read:
 *              every 5 min while visible; while hidden the 5-min heartbeat
 *              is the full pass. It closes what a probe cannot see (a commit
 *              stamped earlier than the overlap the probe allows).
 *   catch-up   a plain cycle of both engines, now and again 5 s later: when
 *              this tab becomes visible and when the channel comes up. The
 *              echo exists because a channel reports itself subscribed a few
 *              seconds before changes start reaching it.
 *
 * "Visible" is the browser's, not this tab's: another tab that is being
 * looked at says so every 30 s, and that keeps the visible cadence for 45 s.
 */

export const HEARTBEAT_UP_MS = 60_000;
export const HEARTBEAT_DOWN_MS = 15_000;
export const HEARTBEAT_HIDDEN_MS = 300_000;
export const FULL_PASS_MS = 300_000;
export const CATCH_UP_ECHO_MS = 5_000;
export const PEER_VISIBLE_TTL_MS = 45_000;

export interface CadenceClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CadenceActions {
  /** Rejections are the action's to report; the clock goes on regardless. */
  heartbeat(input: { visible: boolean }): Promise<void>;
  fullPass(): void;
  catchUp(): void;
}

export interface SyncCadence {
  start(): void;
  stop(): void;
  /** This tab became visible (true) or hidden (false). */
  setVisible(visible: boolean): void;
  /** The nudge channel is subscribed (true) or not (false). */
  setChannelUp(up: boolean): void;
  /** Another tab of this browser is visible right now. */
  peerVisible(): void;
  /**
   * A catch-up now and again after the echo, as when this tab becomes
   * visible — for another tab of the browser the person just turned to.
   * The heartbeat stays where it was.
   */
  catchUpNow(): void;
}

export function createSyncCadence(
  clock: CadenceClock,
  actions: CadenceActions,
  initial: { visible: boolean; channelUp: boolean }
): SyncCadence {
  let started = false;
  let stopped = false;
  let ownVisible = initial.visible;
  let channelUp = initial.channelUp;
  let lastPeerVisible = -Infinity;
  /** The heartbeat interval is counted from here. */
  let anchor = 0;
  let lastFullPass = 0;
  let inFlight = false;
  let heartbeatTimer: unknown = null;
  let fullPassTimer: unknown = null;
  let echoTimer: unknown = null;

  const live = () => started && !stopped;

  const browserVisible = () =>
    ownVisible || clock.now() - lastPeerVisible < PEER_VISIBLE_TTL_MS;

  const interval = () =>
    !browserVisible()
      ? HEARTBEAT_HIDDEN_MS
      : channelUp
        ? HEARTBEAT_UP_MS
        : HEARTBEAT_DOWN_MS;

  const clear = (handle: unknown) => {
    if (handle !== null) clock.clearTimeout(handle);
  };

  const armHeartbeat = () => {
    clear(heartbeatTimer);
    heartbeatTimer = clock.setTimeout(
      onHeartbeatTimer,
      Math.max(0, anchor + interval() - clock.now())
    );
  };

  const armFullPass = () => {
    clear(fullPassTimer);
    fullPassTimer = clock.setTimeout(
      onFullPassTimer,
      Math.max(0, lastFullPass + FULL_PASS_MS - clock.now())
    );
  };

  function onHeartbeatTimer() {
    heartbeatTimer = null;
    if (!live()) return;
    // The interval may have grown since this was armed (a peer's visible
    // beat expired): wait out the rest of it.
    if (clock.now() < anchor + interval()) {
      armHeartbeat();
      return;
    }
    anchor = clock.now();
    const visible = browserVisible();
    if (!inFlight) {
      inFlight = true;
      actions
        .heartbeat({ visible })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    }
    if (!visible) {
      // Nobody is looking: this heartbeat is also the full pass.
      lastFullPass = clock.now();
      actions.fullPass();
      armFullPass();
    }
    armHeartbeat();
  }

  function onFullPassTimer() {
    fullPassTimer = null;
    if (!live()) return;
    lastFullPass = clock.now();
    if (browserVisible()) actions.fullPass();
    armFullPass();
  }

  const catchUp = () => {
    actions.catchUp();
    clear(echoTimer);
    echoTimer = clock.setTimeout(() => {
      echoTimer = null;
      if (live()) actions.catchUp();
    }, CATCH_UP_ECHO_MS);
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      anchor = clock.now();
      lastFullPass = clock.now();
      catchUp();
      armHeartbeat();
      armFullPass();
    },
    stop() {
      stopped = true;
      clear(heartbeatTimer);
      clear(fullPassTimer);
      clear(echoTimer);
      heartbeatTimer = fullPassTimer = echoTimer = null;
    },
    setVisible(visible) {
      if (visible === ownVisible) return;
      ownVisible = visible;
      if (!live()) return;
      if (visible) {
        catchUp();
        anchor = clock.now();
      }
      armHeartbeat();
    },
    setChannelUp(up) {
      if (up === channelUp) return;
      channelUp = up;
      if (!live()) return;
      if (up) {
        catchUp();
        anchor = clock.now();
      }
      armHeartbeat();
    },
    peerVisible() {
      const wasVisible = browserVisible();
      lastPeerVisible = clock.now();
      if (live() && !wasVisible) armHeartbeat();
    },
    catchUpNow() {
      if (live()) catchUp();
    },
  };
}
