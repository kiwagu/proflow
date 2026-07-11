'use client';

import * as React from 'react';

import type { Containment } from '../containment';

/**
 * Bulk-action fan-out for the Drive workbench (release-hardening B2). Each bulk verb is
 * a client FAN-OUT over the EXISTING per-id RLS routes with `Promise.allSettled`, so one
 * RLS-denied node never aborts the rest — the result is an HONEST `{ done, skipped }`
 * summary (poc-no-fallbacks: real counts, never a mock). The one exception is PURGE,
 * which goes through the ALREADY-BUILT batch endpoint (`DELETE /author/graph/trash` with
 * `resourceIds[]`, max 200 → paged here) whose own response is the honest partial split.
 *
 * After any action completes it CLEARS the selection and re-resolves (`refresh`), then
 * stashes the summary so the bar can surface "N done, M skipped". Zero service-role — the
 * routes run under the user's session; RLS is the sole authority on every id.
 */
export type BulkSummary = { done: number; skipped: number };

async function sendJson(
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST'
): Promise<boolean> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** Batch size for the purge endpoint (contract cap is 200 ids/request). */
const PURGE_BATCH_SIZE = 200;

export function useDriveBulkActions({
  spaceId,
  containment,
  refresh,
  clearSelection,
}: {
  spaceId: string | undefined;
  /** Resolved containment — `parentOf` gives each node's current folder for a move. */
  containment: Containment;
  refresh: () => void;
  clearSelection: () => void;
}) {
  const [running, setRunning] = React.useState(false);
  const [summary, setSummary] = React.useState<BulkSummary | null>(null);

  const dismissSummary = React.useCallback(() => setSummary(null), []);

  // Fan out `perId` over the ids; a fulfilled `true` counts as done, everything else
  // (a fulfilled `false` = RLS-denied / no-op, or a rejected promise) is skipped.
  const fanOut = React.useCallback(
    async (
      ids: string[],
      perId: (id: string) => Promise<boolean>
    ): Promise<BulkSummary> => {
      const settled = await Promise.allSettled(ids.map(perId));
      let done = 0;
      let skipped = 0;
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled' && outcome.value) {
          done += 1;
        } else {
          skipped += 1;
        }
      }
      return { done, skipped };
    },
    []
  );

  // Run a fan-out action end-to-end: guard spaceId, mark running, fan out, then stash the
  // summary + clear the selection + re-resolve.
  const runAction = React.useCallback(
    async (ids: string[], perId: (id: string) => Promise<boolean>) => {
      if (!spaceId || ids.length === 0) {
        return;
      }
      setRunning(true);
      setSummary(null);
      const result = await fanOut(ids, perId);
      setSummary(result);
      setRunning(false);
      clearSelection();
      refresh();
    },
    [spaceId, fanOut, clearSelection, refresh]
  );

  const trashMany = React.useCallback(
    (ids: string[]) =>
      runAction(ids, (id) =>
        sendJson(
          '/author/graph/resources',
          { spaceId, resourceId: id },
          'DELETE'
        )
      ),
    [runAction, spaceId]
  );

  const starMany = React.useCallback(
    (ids: string[], starred: boolean) =>
      runAction(ids, (id) =>
        sendJson('/author/graph/starred', { spaceId, nodeId: id, starred })
      ),
    [runAction, spaceId]
  );

  const restoreMany = React.useCallback(
    (ids: string[]) =>
      runAction(ids, (id) =>
        sendJson('/author/graph/trash', { spaceId, resourceId: id }, 'PATCH')
      ),
    [runAction, spaceId]
  );

  // Move = re-parent each node: drop its current `contains` edge (single parent), then
  // add one from the chosen folder (unless "top level"). Mirrors NodeActionsMenu.onMove
  // per node. A node already at the target is a no-op = done.
  const moveMany = React.useCallback(
    (ids: string[], target: string) =>
      runAction(ids, async (id) => {
        const currentParent = containment.parentOf.get(id);
        if (currentParent === (target === 'top' ? undefined : target)) {
          return true; // already there
        }
        let ok = true;
        if (currentParent) {
          ok = await sendJson(
            '/author/graph/edges',
            {
              spaceId,
              fromId: currentParent,
              toId: id,
              relationType: 'contains',
            },
            'DELETE'
          );
        }
        if (ok && target !== 'top') {
          ok = await sendJson('/author/graph/edges', {
            action: 'contain',
            spaceId,
            folderId: target,
            childId: id,
          });
        }
        return ok;
      }),
    [runAction, spaceId, containment]
  );

  // Purge (Empty Trash / bulk Delete-forever) — the irreversible batch endpoint, paged
  // at the contract's 200-id cap. Its own response carries the honest partial split
  // (`purged` vs `skipped`), which we aggregate across pages. Never per-id here.
  const purgeMany = React.useCallback(
    async (ids: string[]) => {
      if (!spaceId || ids.length === 0) {
        return;
      }
      setRunning(true);
      setSummary(null);
      let done = 0;
      let skipped = 0;
      for (let i = 0; i < ids.length; i += PURGE_BATCH_SIZE) {
        const page = ids.slice(i, i + PURGE_BATCH_SIZE);
        const res = await fetch('/author/graph/trash', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spaceId, resourceIds: page }),
        });
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as {
            purged?: string[];
            skipped?: unknown[];
          } | null;
          done += body?.purged?.length ?? 0;
          skipped += body?.skipped?.length ?? 0;
        } else {
          // A whole-page transport failure → the page survived (honest: skipped).
          skipped += page.length;
        }
      }
      setSummary({ done, skipped });
      setRunning(false);
      clearSelection();
      refresh();
    },
    [spaceId, clearSelection, refresh]
  );

  return {
    running,
    summary,
    dismissSummary,
    trashMany,
    starMany,
    restoreMany,
    moveMany,
    purgeMany,
  };
}
