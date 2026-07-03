'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * The workbench refresh + Trash lens lifecycle (ADR-0018) — RESTORE + PURGE.
 *
 * `refresh` bumps a client `refreshKey` AND `router.refresh()`es so the server page
 * re-resolves under the user's RLS; every mutation in the workbench routes through it.
 *
 * Restore + purge are reached only from the Trash lens and run under the user's RLS via
 * the distinct `/author/graph/trash` route (PATCH = restore, DELETE = purge). The DB
 * guards are the sole authority: an unauthorized restore is a clean no-op; an in-use
 * purge is rejected (the route tags `reason: 'in-use'`). A success re-resolves so the
 * trashed node leaves (restore) / is gone (purge).
 *
 * Restore also has to REVEAL the node at its KB position once the re-resolve lands — but
 * the `contains` edge is only active after the refresh, so the caller passes an
 * `onRestored(nodeId)` it wires to the navigation/reveal machinery.
 */
export function useDriveMutations({
  spaceId,
  onRestored,
}: {
  spaceId: string | undefined;
  onRestored: (nodeId: string) => void;
}) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = React.useState(0);

  const refresh = React.useCallback(() => {
    setRefreshKey((key) => key + 1);
    router.refresh();
  }, [router]);

  const restoreNode = React.useCallback(
    async (nodeId: string): Promise<boolean> => {
      if (!spaceId) {
        return false;
      }
      const res = await fetch('/author/graph/trash', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, resourceId: nodeId }),
      });
      if (res.ok) {
        // Jump to the restored node's position in the KB tree — the SAME reveal as the
        // panel / ⋯ "Open in KB". The caller switches to the kb lens now; the deferred
        // reveal performs the actual jump once the re-resolved containment knows the
        // node's now-active parent (the `contains` edge is dormant while trashed).
        onRestored(nodeId);
        refresh();
        return true;
      }
      return false;
    },
    [spaceId, refresh, onRestored]
  );

  const purgeNode = React.useCallback(
    async (nodeId: string): Promise<'purged' | 'in-use' | 'error'> => {
      if (!spaceId) {
        return 'error';
      }
      const res = await fetch('/author/graph/trash', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, resourceId: nodeId }),
      });
      if (res.ok) {
        refresh();
        return 'purged';
      }
      // The route distinguishes the in-use guard rejection from any other clean
      // failure (graceful — nothing was destroyed either way).
      const body = (await res.json().catch(() => null)) as {
        reason?: string;
      } | null;
      return body?.reason === 'in-use' ? 'in-use' : 'error';
    },
    [spaceId, refresh]
  );

  // REMOVE SHORTCUT — delete the `shortcut` edge folder→target (ADR-0015 §3). The
  // symlink card carries both endpoints (its containing folder = from, the target =
  // to), so we delete by the natural (from,to,relation) triple with no id round-trip.
  // Only the edge is removed; the target node and its canonical home are untouched.
  // RLS (`space.knowledge.delete`) is the sole authority — a disallowed remove is a
  // clean no-op. A success re-resolves so the shortcut card leaves the canvas.
  const removeShortcut = React.useCallback(
    async (folderId: string, targetId: string): Promise<boolean> => {
      if (!spaceId) {
        return false;
      }
      const res = await fetch('/author/graph/edges', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          fromId: folderId,
          toId: targetId,
          relationType: 'shortcut',
        }),
      });
      if (res.ok) {
        refresh();
        return true;
      }
      return false;
    },
    [spaceId, refresh]
  );

  return { refreshKey, refresh, restoreNode, purgeNode, removeShortcut };
}
