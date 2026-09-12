'use client';

import { useCallback } from 'react';
import type { Containment } from './containment.js';
import { isSelfOrDescendant } from './containment.js';
import {
  useCurrentUserId,
  useGraphCommands,
  useReportGraphError,
  useSpaceId,
} from './graph-services.js';

/**
 * The drive's structural commands, over the local ports.
 *
 * What changed against the server-backed surface this replaces: there is no
 * `refresh` and no re-resolve. A command writes the replica and its journal in
 * one local transaction, and the live queries the views subscribe to fire on
 * their own — so the canvas is correct before the network has been touched at
 * all, and stays correct offline. What the server used to decide at the moment
 * of the click it now decides on replay, and a refusal is reconciled by the
 * ordinary pull (the sync worker's job, not this surface's).
 *
 * Every command returns whether it was accepted LOCALLY, which is what a bulk
 * summary can honestly count here: local acceptance, not server acceptance.
 */
export type MoveTarget = string | null;

export function useDriveMutations(containment: Containment) {
  const commands = useGraphCommands();
  const spaceId = useSpaceId();
  const userId = useCurrentUserId();
  const reportError = useReportGraphError();

  /** Runs a command, surfacing its failure to the host rather than throwing. */
  const run = useCallback(
    async (result: Promise<{ isErr: () => boolean; error?: string }>) => {
      const outcome = await result;
      if (outcome.isErr()) {
        reportError(String((outcome as { error: string }).error));
        return false;
      }
      return true;
    },
    [reportError]
  );

  /**
   * Re-parent a node: moves containment to target (or top level if null) in one
   * atomic transaction with a single `move_node` journal operation.
   */
  const moveNode = useCallback(
    async (nodeId: string, target: MoveTarget): Promise<boolean> => {
      const currentParent = containment.parentOf.get(nodeId) ?? null;
      if (currentParent === target) {
        return true; // already there — a no-op is an honest success
      }
      if (target && isSelfOrDescendant(containment, nodeId, target)) {
        reportError('A folder cannot be moved into its own subtree.');
        return false;
      }
      return run(
        commands.moveNode(
          { spaceId, nodeId, targetParentId: target, position: 0 },
          userId
        )
      );
    },
    [commands, containment, reportError, run, spaceId, userId]
  );

  /**
   * Deep-copy a node and its subtree into a folder (null = top level). The
   * local write covers the nodes and their containment; the journaled op
   * carries the id map so the server's replay reproduces the bodies and the
   * satellites (link URLs, media references) that replicate down-only.
   */
  const copyNode = useCallback(
    async (
      sourceId: string,
      target: MoveTarget,
      rootTitle?: string
    ): Promise<boolean> => {
      if (target && isSelfOrDescendant(containment, sourceId, target)) {
        // Copying a folder into its own subtree would recurse forever.
        reportError('A folder cannot be copied into its own subtree.');
        return false;
      }
      const result = await commands.copySubtree({
        spaceId,
        sourceId,
        targetFolderId: target,
        createdBy: userId,
        ...(rootTitle ? { rootTitle } : {}),
      });
      if (result.isErr()) {
        reportError(result.error);
        return false;
      }
      return true;
    },
    [commands, containment, reportError, spaceId, userId]
  );

  /**
   * Trash a node. Only the node's own columns are written: the server's
   * cascade over the containment subtree is the authority, and the replica
   * mirrors its outcome on the next pull rather than reimplementing it.
   */
  const trashNode = useCallback(
    (nodeId: string) => run(commands.trashNode(nodeId, userId)),
    [commands, run, userId]
  );

  const restoreNode = useCallback(
    (nodeId: string) => run(commands.restoreNode(nodeId)),
    [commands, run]
  );

  /** Purge — a real delete here and, on replay, on the server. One way. */
  const purgeNode = useCallback(
    (nodeId: string) => run(commands.purgeNode(nodeId)),
    [commands, run]
  );

  const setStarred = useCallback(
    (nodeId: string, starred: boolean) =>
      run(commands.setStarred(spaceId, nodeId, userId, starred)),
    [commands, run, spaceId, userId]
  );

  const renameNode = useCallback(
    (nodeId: string, title: string) => run(commands.renameNode(nodeId, title)),
    [commands, run]
  );

  /**
   * Remove a shortcut — delete the `shortcut` edge folder→target by its
   * natural key. Only the edge goes; the target and its canonical home stay.
   */
  const removeShortcut = useCallback(
    (folderId: string, targetId: string) =>
      run(commands.removeEdge(spaceId, folderId, targetId, 'shortcut')),
    [commands, run, spaceId]
  );

  /** Place a shortcut (a cross-folder alias) from a folder to a target. */
  const createShortcut = useCallback(
    (folderId: string, targetId: string) =>
      run(
        commands.upsertEdge({
          spaceId,
          from: folderId,
          to: targetId,
          relationType: 'shortcut',
          createdBy: userId,
        })
      ),
    [commands, run, spaceId, userId]
  );

  /** Record a deliberate open — activity, never an edit. */
  const markOpened = useCallback(
    (nodeId: string) => run(commands.markOpened(spaceId, nodeId, userId)),
    [commands, run, spaceId, userId]
  );

  return {
    moveNode,
    copyNode,
    trashNode,
    restoreNode,
    purgeNode,
    setStarred,
    renameNode,
    removeShortcut,
    createShortcut,
    markOpened,
  };
}

export type DriveMutations = ReturnType<typeof useDriveMutations>;
