import { entityIdRegistry } from '@workspace/entity-id';
import { describe, expect, it, vi } from 'vitest';
import { createChangeProbe, type ProbeRow } from './sync-probe';

/**
 * Which engine a heartbeat kicks, from the space's change marks. The marks
 * are the server's clock; the probe answers with the server's time of the
 * answer too, and every comparison stays on that one clock — this device's
 * clock may be off by far more than the overlap. The device's clock is only
 * ever used for a difference (how long ago this page started).
 */

const SPACE = entityIdRegistry.factories.spaceIdFactory.brand(
  'spc_0000000000000001.0000000000'
);
const SECOND = 1_000;
/** The server's clock, deliberately far from the device's. */
const SERVER = Date.parse('2026-10-14T12:00:00.000Z');
const at = (ms: number) => new Date(ms).toISOString();

function row(probedAt: number, marks: Partial<ProbeRow> = {}): ProbeRow {
  return {
    epoch: 0,
    graph_changed_at: null,
    graph_deleted_at: null,
    documents_changed_at: null,
    probed_at: at(probedAt),
    ...marks,
  };
}

/** A device whose page started at `startedAt` on its own clock. */
function device(answers: ProbeRow[], startedAt = 1_000 * SECOND) {
  let now = startedAt;
  const probe = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next;
  });
  const beat = vi.fn(async () => undefined);
  const changes = createChangeProbe({
    probe,
    beat,
    startedAt: now,
    now: () => now,
  });
  return {
    probe,
    beat,
    changes,
    /** The device's clock moves on by this much. */
    wait(ms: number) {
      now += ms;
    },
  };
}

describe('the change probe', () => {
  it('first heartbeat kicks a kind marked after the page started (less the overlap), not one before', async () => {
    // The page started 60 s before the first heartbeat, by the device's
    // clock; the server answers at SERVER, so it started at SERVER − 60 s.
    const d = device([
      row(SERVER, {
        graph_changed_at: at(SERVER - 64 * SECOND),
        documents_changed_at: at(SERVER - 70 * SECOND),
      }),
    ]);
    d.wait(60 * SECOND);
    expect(await d.changes.heartbeat(SPACE, { visible: true })).toEqual({
      graph: true,
      graphDelete: false,
      documents: false,
    });
    expect(d.probe).toHaveBeenCalledWith(SPACE);
  });

  it('a later heartbeat kicks only the kinds that moved since the last one', async () => {
    const d = device([
      row(SERVER, { graph_changed_at: at(SERVER - 50 * SECOND) }),
      row(SERVER + 60 * SECOND, {
        graph_changed_at: at(SERVER - 50 * SECOND),
        documents_changed_at: at(SERVER + 30 * SECOND),
      }),
    ]);
    d.wait(60 * SECOND);
    await d.changes.heartbeat(SPACE, { visible: true });
    d.wait(60 * SECOND);
    expect(await d.changes.heartbeat(SPACE, { visible: true })).toEqual({
      graph: false,
      graphDelete: false,
      documents: true,
    });
  });

  it('a deletion is its own kind', async () => {
    const d = device([
      row(SERVER, {
        graph_changed_at: at(SERVER - 10 * SECOND),
        graph_deleted_at: at(SERVER - 10 * SECOND),
      }),
    ]);
    d.wait(60 * SECOND);
    expect(await d.changes.heartbeat(SPACE, { visible: true })).toEqual({
      graph: true,
      graphDelete: true,
      documents: false,
    });
  });

  it('the overlap re-kicks a change marked inside 5 s of the last look, once', async () => {
    // A write inside the second the mark was taken leaves no new mark, and
    // may have landed after the pull the first kick ran.
    const mark = at(SERVER - 2 * SECOND);
    const d = device([
      row(SERVER, { graph_changed_at: mark }),
      row(SERVER + 60 * SECOND, { graph_changed_at: mark }),
      row(SERVER + 120 * SECOND, { graph_changed_at: mark }),
    ]);
    d.wait(60 * SECOND);
    expect((await d.changes.heartbeat(SPACE, { visible: true })).graph).toBe(
      true
    );
    d.wait(60 * SECOND);
    expect((await d.changes.heartbeat(SPACE, { visible: true })).graph).toBe(
      true
    );
    d.wait(60 * SECOND);
    expect((await d.changes.heartbeat(SPACE, { visible: true })).graph).toBe(
      false
    );
  });

  it('is not fooled by a device clock far ahead of the server', async () => {
    // Every comparison is on the server's clock: the device being an hour
    // ahead changes nothing. Measured against the device's own time, the
    // change 30 s after the first look would sit an hour in the past.
    const d = device(
      [
        row(SERVER),
        row(SERVER + 60 * SECOND, {
          graph_changed_at: at(SERVER + 30 * SECOND),
        }),
      ],
      SERVER + 60 * 60 * SECOND
    );
    d.wait(60 * SECOND);
    await d.changes.heartbeat(SPACE, { visible: true });
    d.wait(60 * SECOND);
    expect((await d.changes.heartbeat(SPACE, { visible: true })).graph).toBe(
      true
    );
  });

  it('beats presence only while the browser is visible', async () => {
    const d = device([row(SERVER), row(SERVER + 60 * SECOND)]);
    await d.changes.heartbeat(SPACE, { visible: false });
    expect(d.beat).not.toHaveBeenCalled();
    await d.changes.heartbeat(SPACE, { visible: true });
    expect(d.beat).toHaveBeenCalledWith(SPACE);
  });

  it('hands a failed probe or beat to the caller, and the next heartbeat still sees the change', async () => {
    const d = device([
      row(SERVER + 60 * SECOND, { graph_changed_at: at(SERVER + 30 * SECOND) }),
    ]);
    // The page started at SERVER on the server's clock.
    d.wait(60 * SECOND);
    d.probe.mockRejectedValueOnce(new Error('change probe failed'));
    await expect(
      d.changes.heartbeat(SPACE, { visible: false })
    ).rejects.toThrow('change probe failed');
    d.beat.mockRejectedValueOnce(new Error('presence beat failed'));
    await expect(d.changes.heartbeat(SPACE, { visible: true })).rejects.toThrow(
      'presence beat failed'
    );
    d.probe.mockResolvedValueOnce(
      row(SERVER + 60 * SECOND, { graph_changed_at: at(SERVER + 30 * SECOND) })
    );
    expect((await d.changes.heartbeat(SPACE, { visible: false })).graph).toBe(
      true
    );
  });

  it('refuses an answer that carries no server time', async () => {
    const d = device([{ ...row(SERVER), probed_at: 'not a time' }]);
    await expect(
      d.changes.heartbeat(SPACE, { visible: false })
    ).rejects.toThrow(/time/);
  });
});
