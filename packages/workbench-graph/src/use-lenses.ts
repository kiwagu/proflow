'use client';

import {
  useGraphNodes,
  useStarredIds,
} from '@workspace/persistence-pglite/react';
import type { GraphNode } from '@workspace/persistence-pglite';
import { useMemo } from 'react';
import { useGraphReader, useSpaceId } from './graph-services.js';

/**
 * The Trash lens.
 *
 * Trash is not a table: it is the existence lens over the node's own
 * `deleted_at`, exactly as on the server. So the lens is one live query with a
 * different predicate — not a separate store, not a separate route — and
 * restore/purge are ordinary commands on the same rows.
 */
export function useTrashLens(): { nodes: GraphNode[]; isEmpty: boolean } {
  const reader = useGraphReader();
  const spaceId = useSpaceId();
  const nodes = useGraphNodes(reader, spaceId, 'trashed');
  return { nodes, isEmpty: nodes.length === 0 };
}

/**
 * The Starred lens — the current user's starred nodes, live.
 *
 * Starred is per-USER state (`resource_user_state`), while the node row is
 * shared; the lens is that join, resolved locally. A starred id whose node is
 * not in the replica (not yet pulled, or trashed) simply does not appear —
 * the same narrowing the server fan-out applies.
 */
export function useStarredLens(): { nodes: GraphNode[]; isEmpty: boolean } {
  const reader = useGraphReader();
  const spaceId = useSpaceId();
  const nodes = useGraphNodes(reader, spaceId, 'live');
  const starredIds = useStarredIds(reader, spaceId);

  const starred = useMemo(() => {
    const ids = new Set(starredIds);
    return nodes.filter((node) => ids.has(node.id));
  }, [nodes, starredIds]);

  return { nodes: starred, isEmpty: starred.length === 0 };
}
