/**
 * The workbench data layer's vocabulary — the local equivalents of the
 * shapes the `/author/graph/*` render surface reads from server routes
 * today. Server rows travel under the server's own column shapes
 * (mechanical mapping, no rename layer); these are their camelCase
 * projections for the views.
 */

/** Broadcast floor — the single per-resource dial. */
export type ResourceFloor = 'private' | 'space' | 'organization';

/** The existence lens: normal browse vs the Trash lens. */
export type LifecycleScope = 'live' | 'trashed';

/**
 * A graph node as the canvas/cards read it. Carries everything the
 * card meta line and panel read from the node row — owner, edit recency,
 * floor, workflow status — so no per-item ride-alongside fetch remains.
 */
export type GraphNode = {
  id: string;
  spaceId: string;
  kind: string;
  title: string;
  status: string;
  visibility: ResourceFloor;
  workflowKey: string | null;
  ownerUserId: string | null;
  createdBy: string;
  /** Trash state: set → the node is in the Trash lens. */
  deletedAt: Date | null;
  trashedBy: string | null;
  /** Edit recency roll-up (node + body + satellite + edge, excluding opens). */
  lastModifiedAt: Date;
  /** Activity recency (also counts opens). */
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * One directed edge, as the forests read it: `from` the container/source,
 * `to` the child/target, ordered by `position`. The relation vocabulary is
 * server data (`contains`, `shortcut`, `tagged`, `relates_to`, …) — the
 * replica never narrows it.
 */
export type GraphEdge = {
  id: string;
  spaceId: string;
  from: string;
  to: string;
  relationType: string;
  position: number;
  metadata: Record<string, unknown>;
};

/** One tag node (`kind='tag'`) — id + title, as the chips/facet read it. */
export type ResourceTag = {
  id: string;
  title: string;
};

/** KB satellite attributes of ONE node, as the cards/panel read them. */
export type KbAttributes = {
  /** Description text. Absent → never set. */
  description?: string;
  /** External URL + display host for `kind=link`. */
  link?: { url: string; host: string | null };
  /**
   * Media satellite — present only when the node has confirmed bytes.
   * Byte-intrinsic fields come from the shared blob row it references.
   */
  media?: {
    byteSize: number | null;
    durationMs: number | null;
    mimeType: string | null;
    storagePath: string;
    originalFilename: string;
  };
};

/**
 * The current user's per-resource state in a space — own rows only by
 * construction (the replica is per-user). One row per opened/starred/
 * progressed resource; a missing entry means "no state yet".
 */
export type UserResourceState = {
  resourceId: string;
  coarseStatus: string;
  progress: number | null;
  starred: boolean;
  lastOpenedAt: Date | null;
};

/**
 * One journaled structural command awaiting push — the sync worker's unit
 * of replay. `op`/`payload` mirror the idempotent server operations
 * (create → upsert by client-minted id, column patches keyed by id, edge
 * upsert on the natural key, timestamp writes, delete by id); `nodeIds`
 * names every node the op touches, so a rejection can drop all ops
 * depending on the same node before re-pulling.
 */
export type GraphOp = {
  id: number;
  spaceId: string;
  op: string;
  payload: Record<string, unknown>;
  nodeIds: string[];
  createdAt: Date;
};
