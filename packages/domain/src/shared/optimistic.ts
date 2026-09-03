import type { Result } from 'neverthrow';
import type { Unsubscribe } from './subscription.js';

/**
 * An intent is the outcome a command promises, expressed against the read
 * model it will eventually change. Two questions, both pure:
 *
 *  - `project`: what would the read model look like if the command had
 *    already landed?
 *  - `reflected`: does this snapshot from the source already show it?
 *
 * Keeping both on the intent, and nothing about the command itself, is
 * what lets one overlay serve any read model and any UI surface.
 */
export interface Intent<S> {
  project(state: S): S;
  reflected(state: S): boolean;
}

/** A command in flight, from the overlay's side. */
export interface RunningIntent {
  /** The command succeeded: hold the intent until the source shows it. */
  settled(): void;
  /** The command failed or threw: drop the intent, the source is right. */
  failed(): void;
}

/**
 * A read model whose watchers see every running command's outcome at once,
 * instead of after the source catches up.
 *
 * The source (a live query, a subscription) is the truth; the overlay holds
 * the intents of commands still in flight and shows the source's latest
 * snapshot with those intents projected on top. An intent is lifted once
 * its command has settled AND the source shows the outcome — or, failing
 * that, after the source has delivered twice since the command settled, a
 * guard against an intent that can never be reflected. A failed command
 * drops its intent immediately, and the view falls back to what the source
 * says: rollback is not a separate step, it is the absence of the overlay.
 */
export interface OptimisticOverlay<S> {
  watch(cb: (state: S) => void): Unsubscribe;
  /** The state as it stands, overlay included; undefined while unwatched. */
  latest(): S | undefined;
  /** Projects `intent` now; the caller reports how its command ended. */
  begin(intent: Intent<S>): RunningIntent;
  /**
   * Shows `intent` right away, runs `command`, and returns its outcome. The
   * overlay outlives the promise: the intent stays projected until the
   * source shows the change.
   */
  run<T, E>(
    intent: Intent<S>,
    command: () => Promise<Result<T, E>>
  ): Promise<Result<T, E>>;
  /** Intents currently projected — for diagnostics and tests. */
  pending(): number;
}

/** Source deliveries after settling before an unreflected intent is given up on. */
const DELIVERIES_AFTER_SETTLE = 2;

/**
 * @param initial what to project a pending command onto while the source
 * has answered nothing yet — a live query can take seconds during start-up,
 * and a creation in that window must still be visible. It is a base for
 * projections, never a delivery of its own: a watcher hears nothing until
 * either the source speaks or a command gives it something to say.
 */
export function createOptimisticOverlay<S>(
  source: (cb: (state: S) => void) => Unsubscribe,
  initial?: S
): OptimisticOverlay<S> {
  type Entry = {
    intent: Intent<S>;
    settled: boolean;
    deliveriesSinceSettle: number;
  };
  const entries: Entry[] = [];
  const watchers = new Set<(state: S) => void>();
  let base: { value: S } | undefined;
  let detach: Unsubscribe | undefined;

  const derived = (): S | undefined => {
    const start: S | undefined = base ? base.value : initial;
    if (start === undefined) return undefined;
    return entries.reduce<S>((s, e) => e.intent.project(s), start);
  };

  const emit = () => {
    const state = derived();
    if (state === undefined) return;
    for (const cb of watchers) cb(state);
  };

  // Lifts `entry` together with everything issued before it. Commands
  // reach one ordered source, so a snapshot showing a later outcome has
  // the earlier ones in it too — and an older intent left projected on
  // top would drag the view back to an intermediate state.
  const liftThrough = (entry: Entry) => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(0, i + 1);
  };

  const onDelivery = (state: S) => {
    base = { value: state };
    const newest = entries
      .filter((e) => e.settled && e.intent.reflected(state))
      .at(-1);
    if (newest) liftThrough(newest);
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as Entry;
      if (!entry.settled) continue;
      entry.deliveriesSinceSettle++;
      if (entry.deliveriesSinceSettle >= DELIVERIES_AFTER_SETTLE)
        entries.splice(i, 1);
    }
    emit();
  };

  const drop = (entry: Entry) => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
  };

  const overlay: OptimisticOverlay<S> = {
    watch(cb) {
      watchers.add(cb);
      if (!detach) detach = source(onDelivery);
      // A later watcher is caught up on what the source has already
      // delivered — but ONLY on that. Handing it the initial state before
      // the source has answered would look like a delivered "there is
      // nothing", and a caller that reads the first delivery as the truth
      // would act on an emptiness that was never observed.
      else if (base) cb(derived() as S);
      return () => {
        watchers.delete(cb);
        if (watchers.size === 0) {
          detach?.();
          detach = undefined;
          base = undefined;
        }
      };
    },

    begin(intent) {
      const entry: Entry = { intent, settled: false, deliveriesSinceSettle: 0 };
      entries.push(entry);
      emit();
      return {
        settled() {
          entry.settled = true;
          // The source may already have shown the outcome while the
          // command was settling; nothing to wait for then.
          if (base && intent.reflected(base.value)) {
            liftThrough(entry);
            emit();
          }
        },
        failed() {
          drop(entry);
          emit();
        },
      };
    },

    async run(intent, command) {
      const running = overlay.begin(intent);
      try {
        const result = await command();
        if (result.isErr()) running.failed();
        else running.settled();
        return result;
      } catch (e) {
        running.failed();
        throw e;
      }
    },

    latest: derived,

    pending: () => entries.length,
  };
  return overlay;
}

/**
 * A row of a read model. Everything reactive in this app is a list of rows
 * with ids, which is what lets three intents — patch, insert, remove —
 * stand in for every in-place edit any surface makes.
 */
export interface Row {
  id: string;
}

/** Keeps a list in the order its reader would deliver it. */
export type RowOrder<R extends Row> = (rows: readonly R[]) => R[];

const keepOrder = <R extends Row>(rows: readonly R[]): R[] => [...rows];

function equals(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  return Object.is(a, b);
}

/** Changes some fields of one row. The outcome is those fields, as given. */
export function patchRow<R extends Row>(
  id: string,
  patch: Partial<R>,
  order: RowOrder<R> = keepOrder
): Intent<R[]> {
  const keys = Object.keys(patch) as Array<keyof R>;
  return {
    project: (rows) =>
      order(rows.map((row) => (row.id === id ? { ...row, ...patch } : row))),
    reflected: (rows) => {
      const row = rows.find((r) => r.id === id);
      return row !== undefined && keys.every((k) => equals(row[k], patch[k]));
    },
  };
}

/**
 * Adds a row the source has not delivered yet. The id is the caller's,
 * minted before the command ran — which is the whole reason a create can
 * be shown at once rather than waited for.
 */
export function insertRow<R extends Row>(
  row: R,
  order: RowOrder<R> = keepOrder
): Intent<R[]> {
  return {
    project: (rows) =>
      rows.some((r) => r.id === row.id) ? order(rows) : order([...rows, row]),
    reflected: (rows) => rows.some((r) => r.id === row.id),
  };
}

/**
 * Removes rows. `select` answers which ones against the CURRENT state, so a
 * deletion that takes descendants with it (a folder, a thread) says so in
 * one place instead of listing ids the caller would have to compute twice.
 */
export function removeRows<R extends Row>(
  select: (rows: readonly R[]) => string[]
): Intent<R[]> {
  let removed: string[] | undefined;
  const idsIn = (rows: readonly R[]) => {
    // Resolved once, against the state the command was issued against: the
    // subtree of a folder is gone from later snapshots, and re-selecting
    // would then match nothing.
    removed ??= select(rows);
    return removed;
  };
  return {
    project: (rows) => {
      const ids = new Set(idsIn(rows));
      return rows.filter((r) => !ids.has(r.id));
    },
    reflected: (rows) =>
      removed !== undefined && !rows.some((r) => removed?.includes(r.id)),
  };
}

/**
 * The optimistic layer of one application, for as many read models as it
 * has: register a source under the name of what it reads, and every command
 * against that name shows up in all of them.
 *
 * The name is the entity, not the query — the file tree and a recent-files
 * list read the same rows through different sources, and a rename must
 * reach both. Which is also why this sits between the ports and the UI
 * rather than inside a component: a second surface reading the same entity
 * is optimistic the moment it registers, with no work of its own.
 */
export interface OptimisticEntities {
  /**
   * Wraps a source so its watchers see pending commands too. The returned
   * source has the same shape, so it drops straight into a port.
   */
  source<R extends Row>(
    entity: string,
    source: (cb: (rows: R[]) => void) => Unsubscribe
  ): WatchedSource<R>;
  /**
   * Runs a command, projecting each intent into every read model of its
   * entity until the sources catch up. A command that changes two entities
   * — renaming a document is a file-tree row and a document row — says so
   * once, here, instead of in each surface that shows one of them.
   */
  run<T, E>(
    projections: Array<Projection<never>>,
    command: () => Promise<Result<T, E>>
  ): Promise<Result<T, E>>;
  /** Intents in flight, in total or for one entity. */
  pending(entity?: string): number;
}

/**
 * A registered source: the watch function to hand back to a port, and what
 * it currently holds — which is how a decorator answers a question about
 * the rows it is about to change without a subscription of its own.
 */
export interface WatchedSource<R extends Row> {
  watch: (cb: (rows: R[]) => void) => Unsubscribe;
  /** The rows as last delivered, overlay included; empty while unwatched. */
  rows: () => readonly R[];
}

/** One entity's share of what a command promises. */
export interface Projection<R extends Row> {
  entity: string;
  intent: Intent<R[]>;
}

/** Types the pair so the intent and the entity's rows cannot drift apart. */
export function project<R extends Row>(
  entity: string,
  intent: Intent<R[]>
): Projection<never> {
  return { entity, intent } as unknown as Projection<never>;
}

export function createOptimisticEntities(): OptimisticEntities {
  // One overlay per registered source; several sources share an entity.
  const byEntity = new Map<string, Array<OptimisticOverlay<Row[]>>>();

  const overlaysOf = (entity: string) => byEntity.get(entity) ?? [];

  return {
    source<R extends Row>(
      entity: string,
      source: (cb: (rows: R[]) => void) => Unsubscribe
    ) {
      // Rows before the first delivery are no rows: a list read model is
      // empty until its query answers, and a creation in that window must
      // still be visible.
      const overlay = createOptimisticOverlay<R[]>(source, []);
      const list = byEntity.get(entity) ?? [];
      list.push(overlay as unknown as OptimisticOverlay<Row[]>);
      byEntity.set(entity, list);
      return {
        watch: (cb: (rows: R[]) => void) => overlay.watch(cb),
        rows: () => overlay.latest() ?? [],
      };
    },

    async run<T, E>(
      projections: Array<Projection<never>>,
      command: () => Promise<Result<T, E>>
    ): Promise<Result<T, E>> {
      const running = projections.flatMap((p) =>
        overlaysOf(p.entity).map((overlay) =>
          overlay.begin(p.intent as unknown as Intent<Row[]>)
        )
      );
      try {
        const result = await command();
        for (const one of running) {
          if (result.isErr()) one.failed();
          else one.settled();
        }
        return result;
      } catch (e) {
        for (const one of running) one.failed();
        throw e;
      }
    },

    pending(entity) {
      const overlays = entity
        ? overlaysOf(entity)
        : [...byEntity.values()].flat();
      // Every overlay of an entity holds the same intents; the count is
      // how many commands are in flight, not how many projections.
      return Math.max(0, ...overlays.map((o) => o.pending()));
    },
  };
}
