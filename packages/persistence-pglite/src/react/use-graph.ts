import { useCallback } from 'react';
import type {
  GraphEdge,
  GraphNode,
  KbAttributes,
  LifecycleScope,
  ResourceTag,
  UserResourceState,
} from '../graph/graph.types.js';
import type { GraphReader } from '../graph/graph.reader.js';
import { useWatch } from './use-watch.js';

/**
 * The workbench views' subscriptions, one hook per question the render
 * surface asks. Each is a thin `useWatch` over the reader's live query: the
 * component re-renders when the underlying rows change and never fetches.
 *
 * Every hook takes the reader as its first argument rather than reaching for
 * a context — the composition root owns wiring, and a test can pass a double.
 * The watch closures are memoised on their arguments, because a fresh
 * function identity would tear down and re-open the subscription on every
 * render.
 */

const NO_NODES: GraphNode[] = [];
const NO_EDGES: GraphEdge[] = [];
const NO_TAGS: ResourceTag[] = [];
const NO_IDS: string[] = [];
const NO_TAGS_BY_NODE: Record<string, ResourceTag[]> = {};
const NO_ATTRIBUTES: Record<string, KbAttributes> = {};
const NO_USER_STATE: Record<string, UserResourceState> = {};

/** The space's nodes in one existence lens (normal browse, or Trash). */
export function useGraphNodes(
  reader: GraphReader,
  spaceId: string,
  scope: LifecycleScope = 'live'
): GraphNode[] {
  return useWatch(
    useCallback(
      (cb: (nodes: GraphNode[]) => void) =>
        reader.watchNodes(spaceId, scope, cb),
      [reader, spaceId, scope]
    ),
    NO_NODES
  );
}

/** Every edge of one relation in the space, position-ordered. */
export function useGraphEdges(
  reader: GraphReader,
  spaceId: string,
  relationType: string
): GraphEdge[] {
  return useWatch(
    useCallback(
      (cb: (edges: GraphEdge[]) => void) =>
        reader.watchEdges(spaceId, relationType, cb),
      [reader, spaceId, relationType]
    ),
    NO_EDGES
  );
}

/** The containment forest's edges — the folder tree, breadcrumb and counts. */
export function useContainmentEdges(
  reader: GraphReader,
  spaceId: string
): GraphEdge[] {
  return useGraphEdges(reader, spaceId, 'contains');
}

/** The shortcut forest's edges — rendered in the workbench, never traversed. */
export function useShortcutEdges(
  reader: GraphReader,
  spaceId: string
): GraphEdge[] {
  return useGraphEdges(reader, spaceId, 'shortcut');
}

/** All tag nodes of the space — the facet's and the tag tray's vocabulary. */
export function useSpaceTags(
  reader: GraphReader,
  spaceId: string
): ResourceTag[] {
  return useWatch(
    useCallback(
      (cb: (tags: ResourceTag[]) => void) => reader.watchSpaceTags(spaceId, cb),
      [reader, spaceId]
    ),
    NO_TAGS
  );
}

/** Per-node tags: `node id → its tag nodes`. */
export function useResourceTags(
  reader: GraphReader,
  spaceId: string
): Record<string, ResourceTag[]> {
  return useWatch(
    useCallback(
      (cb: (tags: Record<string, ResourceTag[]>) => void) =>
        reader.watchResourceTags(spaceId, cb),
      [reader, spaceId]
    ),
    NO_TAGS_BY_NODE
  );
}

/** Per-node KB satellite attributes: description, link, media. */
export function useKbAttributes(
  reader: GraphReader,
  spaceId: string
): Record<string, KbAttributes> {
  return useWatch(
    useCallback(
      (cb: (attributes: Record<string, KbAttributes>) => void) =>
        reader.watchKbAttributes(spaceId, cb),
      [reader, spaceId]
    ),
    NO_ATTRIBUTES
  );
}

/** The current user's per-resource state — starred, progress, last opened. */
export function useUserResourceState(
  reader: GraphReader,
  spaceId: string
): Record<string, UserResourceState> {
  return useWatch(
    useCallback(
      (cb: (state: Record<string, UserResourceState>) => void) =>
        reader.watchUserState(spaceId, cb),
      [reader, spaceId]
    ),
    NO_USER_STATE
  );
}

/** The current user's starred resource ids in the space. */
export function useStarredIds(
  reader: GraphReader,
  spaceId: string
): string[] {
  return useWatch(
    useCallback(
      (cb: (ids: string[]) => void) => reader.watchStarredIds(spaceId, cb),
      [reader, spaceId]
    ),
    NO_IDS
  );
}
