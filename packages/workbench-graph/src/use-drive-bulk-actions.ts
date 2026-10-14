'use client';

import { useCallback, useState } from 'react';
import type { DriveMutations, MoveTarget } from './use-drive-mutations.js';

/**
 * Bulk actions over a selection.
 *
 * Against the server-backed version this replaces, two things changed. The
 * fan-out is no longer over network routes with `Promise.allSettled` — every
 * verb is a local transaction, so the ids are applied in ORDER and the summary
 * counts local acceptance. And there is no batch-size cap: the 200-id page
 * existed because a request body had a limit, and a local write has none.
 *
 * The summary stays honest either way: `done` is what the replica accepted,
 * `skipped` is what it refused (a cycle, a node not in the replica). Server
 * refusal is a later, separate event — reconciled by the pull, with its own
 * notice — and this summary never pretends to speak for it.
 */
export type BulkSummary = { done: number; skipped: number };

export function useDriveBulkActions({
  mutations,
  clearSelection,
}: {
  mutations: DriveMutations;
  clearSelection: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<BulkSummary | null>(null);

  const dismissSummary = useCallback(() => setSummary(null), []);

  const runAction = useCallback(
    async (ids: string[], perId: (id: string) => Promise<boolean>) => {
      if (ids.length === 0) {
        return;
      }
      setRunning(true);
      setSummary(null);
      let done = 0;
      let skipped = 0;
      for (const id of ids) {
        // Sequential on purpose: these are transactions on ONE local database,
        // and a move reads the containment the previous move may have changed.
        // Concurrency here would buy nothing and could interleave a re-parent.
        if (await perId(id)) {
          done += 1;
        } else {
          skipped += 1;
        }
      }
      setSummary({ done, skipped });
      setRunning(false);
      clearSelection();
    },
    [clearSelection]
  );

  const trashMany = useCallback(
    (ids: string[]) => runAction(ids, mutations.trashNode),
    [mutations, runAction]
  );

  const restoreMany = useCallback(
    (ids: string[]) => runAction(ids, mutations.restoreNode),
    [mutations, runAction]
  );

  const purgeMany = useCallback(
    (ids: string[]) => runAction(ids, mutations.purgeNode),
    [mutations, runAction]
  );

  const starMany = useCallback(
    (ids: string[], starred: boolean) =>
      runAction(ids, (id) => mutations.setStarred(id, starred)),
    [mutations, runAction]
  );

  const moveMany = useCallback(
    (ids: string[], target: MoveTarget) =>
      runAction(ids, (id) => mutations.moveNode(id, target)),
    [mutations, runAction]
  );

  return {
    running,
    summary,
    dismissSummary,
    trashMany,
    restoreMany,
    purgeMany,
    starMany,
    moveMany,
  };
}
