'use client';

import {
  useContainmentEdges,
  useGraphNodes,
  useShortcutEdges,
  useStarredIds,
  useUserResourceState,
} from '@workspace/persistence-pglite/react';
import type {
  GraphEdge,
  GraphNode,
  UserResourceState,
} from '@workspace/persistence-pglite';
import { useMemo } from 'react';
import { buildContainment, type Containment } from './containment.js';
import { useGraphReader, useSpaceId } from './graph-services.js';

/**
 * The workbench's live view of one space: the nodes, the two forests, the
 * per-user overlay, and the containment index derived from them.
 *
 * Every field is a live query — the surface subscribes once and re-renders
 * when the rows change, instead of re-fetching after each mutation. That is
 * the whole point of the local layer: a write lands in the replica, the live
 * query fires, and the canvas is already correct without a refresh round-trip.
 */
export type DriveData = {
  /** Live (non-trashed) nodes of the space. */
  nodes: GraphNode[];
  /** The containment forest's edges, position-ordered. */
  containmentEdges: GraphEdge[];
  /** The shortcut forest's edges — rendered, never traversed. */
  shortcutEdges: GraphEdge[];
  /** The derived containment index (folder tree, breadcrumb, drop guard). */
  containment: Containment;
  /** The current user's per-resource state, by resource id. */
  userState: Record<string, UserResourceState>;
  /** The current user's starred ids, as a membership set. */
  starred: Set<string>;
};

export function useDriveData(): DriveData {
  const reader = useGraphReader();
  const spaceId = useSpaceId();

  const nodes = useGraphNodes(reader, spaceId, 'live');
  const containmentEdges = useContainmentEdges(reader, spaceId);
  const shortcutEdges = useShortcutEdges(reader, spaceId);
  const userState = useUserResourceState(reader, spaceId);
  const starredIds = useStarredIds(reader, spaceId);

  const containment = useMemo(
    () => buildContainment(nodes, containmentEdges),
    [nodes, containmentEdges]
  );
  const starred = useMemo(() => new Set(starredIds), [starredIds]);

  return {
    nodes,
    containmentEdges,
    shortcutEdges,
    containment,
    userState,
    starred,
  };
}
