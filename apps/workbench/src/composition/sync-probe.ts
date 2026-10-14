import type { SpaceId } from '@workspace/entity-id';

/**
 * The heartbeat's question to the server: did anything of each kind change
 * in this space since the last look? The answer decides which engine runs a
 * cycle, so an idle space costs one small request a minute instead of a
 * pull of every table.
 *
 * Every timestamp in the answer is the server's: the marks, and the time of
 * the answer itself. Comparisons never mix in this device's clock, which may
 * be off by far more than the overlap allowed — the device's clock is used
 * only for a duration (how long ago this page started).
 *
 * A kind counts as changed when its mark is at or after the last look less
 * a five-second overlap. The overlap re-kicks a change marked just before a
 * look once more: a write inside the second the mark was taken leaves no new
 * mark, and may have committed after the pull the first kick ran.
 */

/** The probe's answer, as the server sends it. */
export interface ProbeRow {
  epoch: number;
  graph_changed_at: string | null;
  graph_deleted_at: string | null;
  documents_changed_at: string | null;
  /** The server's time of the answer. */
  probed_at: string;
}

export interface ChangedKinds {
  /** Rows of the graph changed: a pull of every table. */
  graph: boolean;
  /** Rows of the graph were deleted: an inventory sweep. */
  graphDelete: boolean;
  /** Document bodies moved: a heads pass. */
  documents: boolean;
}

export interface ChangeProbe {
  heartbeat(
    spaceId: SpaceId,
    input: { visible: boolean }
  ): Promise<ChangedKinds>;
}

export const PROBE_OVERLAP_MS = 5_000;

type Kind = keyof ChangedKinds;

export function createChangeProbe(deps: {
  probe(spaceId: SpaceId): Promise<ProbeRow>;
  beat(spaceId: SpaceId): Promise<void>;
  /** When this page started, on this device's clock. */
  startedAt: number;
  now?: () => number;
  overlapMs?: number;
}): ChangeProbe {
  const now = deps.now ?? (() => Date.now());
  const overlap = deps.overlapMs ?? PROBE_OVERLAP_MS;
  /** Server time of the last look, per kind; none before the first. */
  const lastLook = new Map<Kind, number>();

  return {
    async heartbeat(spaceId, { visible }) {
      const askedAt = now();
      // Presence only while someone looks at the space; it rides along with
      // the probe rather than after it.
      const [row] = await Promise.all([
        deps.probe(spaceId),
        visible ? deps.beat(spaceId) : Promise.resolve(),
      ]);
      const probedAt = Date.parse(row.probed_at);
      if (!Number.isFinite(probedAt))
        throw new Error('the change probe answered without a server time');
      // Before the first look, "the last look" is when this page started:
      // the engines' first cycles read everything up to then. In server
      // time, that is the answer's time less how long the page has run.
      const started = probedAt - (askedAt - deps.startedAt);
      const marks: Record<Kind, string | null> = {
        graph: row.graph_changed_at,
        graphDelete: row.graph_deleted_at,
        documents: row.documents_changed_at,
      };
      const changed = {} as ChangedKinds;
      for (const kind of Object.keys(marks) as Kind[]) {
        const mark = marks[kind];
        const at = mark === null ? null : Date.parse(mark);
        const since = lastLook.get(kind) ?? started;
        // A mark that cannot be read is treated as a change: a pull costs
        // less than a change never fetched.
        changed[kind] =
          at !== null && (!Number.isFinite(at) || at >= since - overlap);
        lastLook.set(
          kind,
          at !== null && Number.isFinite(at) ? Math.max(at, probedAt) : probedAt
        );
      }
      return changed;
    },
  };
}
