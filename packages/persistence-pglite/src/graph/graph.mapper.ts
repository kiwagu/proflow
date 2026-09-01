import type {
  GraphEdge,
  GraphNode,
  GraphOp,
  KbAttributes,
  ResourceFloor,
  UserResourceState,
} from './graph.types.js';

/**
 * Row shapes as the replica stores them (server column names, mechanically
 * mapped) and their projections into the view vocabulary. Timestamps come
 * back from the driver as `Date`; a replica row can never carry a null
 * where the server's NOT NULL holds, so the mappers do not defend against
 * shapes the schema forbids.
 */

export type GraphNodeRow = {
  id: string;
  space_id: string;
  kind: string;
  title: string;
  status: string;
  visibility: string;
  workflow_key: string | null;
  owner_user_id: string | null;
  created_by: string;
  deleted_at: Date | null;
  trashed_by: string | null;
  last_modified_at: Date;
  last_activity_at: Date;
  created_at: Date;
  updated_at: Date;
};

/** Every node column the views read, in one place so reads cannot drift. */
export const GRAPH_NODE_COLUMNS = `id, space_id, kind, title, status, visibility,
       workflow_key, owner_user_id, created_by, deleted_at, trashed_by,
       last_modified_at, last_activity_at, created_at, updated_at`;

/** The same node columns qualified by a table alias, for joined reads. */
export function graphNodeColumns(alias: string): string {
  return GRAPH_NODE_COLUMNS.split(',')
    .map((column) => `${alias}.${column.trim()}`)
    .join(', ');
}

export function toGraphNode(row: GraphNodeRow): GraphNode {
  return {
    id: row.id,
    spaceId: row.space_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    // The floor vocabulary is server data; the replica never refuses a value
    // the server accepted, so this is a projection, not a validation.
    visibility: row.visibility as ResourceFloor,
    workflowKey: row.workflow_key,
    ownerUserId: row.owner_user_id,
    createdBy: row.created_by,
    deletedAt: row.deleted_at,
    trashedBy: row.trashed_by,
    lastModifiedAt: row.last_modified_at,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type GraphEdgeRow = {
  id: string;
  space_id: string;
  from_id: string;
  to_id: string;
  relation_type: string;
  position: number;
  metadata: unknown;
};

export const GRAPH_EDGE_COLUMNS = `id, space_id, from_id, to_id, relation_type,
       "position", metadata`;

export function toGraphEdge(row: GraphEdgeRow): GraphEdge {
  return {
    id: row.id,
    spaceId: row.space_id,
    from: row.from_id,
    to: row.to_id,
    relationType: row.relation_type,
    position: row.position,
    metadata: asRecord(row.metadata),
  };
}

export type UserStateRow = {
  resource_id: string;
  coarse_status: string;
  progress: number | null;
  starred: boolean;
  last_opened_at: Date | null;
};

export function toUserResourceState(row: UserStateRow): UserResourceState {
  return {
    resourceId: row.resource_id,
    coarseStatus: row.coarse_status,
    progress: row.progress,
    starred: row.starred,
    lastOpenedAt: row.last_opened_at,
  };
}

/**
 * One node's satellite attributes, joined server-side into a single row per
 * node. The satellites are optional by construction: a node with no row
 * carries no attribute (absent, never a filled-in default) — the same
 * contract the server fan-out honours.
 */
export type KbAttributeRow = {
  node_id: string;
  description: string | null;
  link_url: string | null;
  link_host: string | null;
  media_original_filename: string | null;
  media_storage_path: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | string | null;
  media_duration_ms: number | null;
};

export function toKbAttributes(row: KbAttributeRow): KbAttributes {
  const attributes: KbAttributes = {};
  if (row.description !== null) attributes.description = row.description;
  if (row.link_url !== null) {
    attributes.link = { url: row.link_url, host: row.link_host };
  }
  // A reference without a readable blob row carries no media attribute —
  // fail-closed, exactly as the server fan-out drops it.
  if (row.media_original_filename !== null && row.media_storage_path !== null) {
    attributes.media = {
      // bigint arrives as a string from the wire protocol.
      byteSize: row.media_size_bytes === null ? null : Number(row.media_size_bytes),
      durationMs: row.media_duration_ms,
      mimeType: row.media_mime_type,
      storagePath: row.media_storage_path,
      originalFilename: row.media_original_filename,
    };
  }
  return attributes;
}

export type GraphOpRow = {
  id: number | string;
  space_id: string;
  op: string;
  payload: unknown;
  node_ids: string[];
  created_at: Date;
};

export function toGraphOp(row: GraphOpRow): GraphOp {
  return {
    id: Number(row.id),
    spaceId: row.space_id,
    op: row.op,
    payload: asRecord(row.payload),
    nodeIds: row.node_ids,
    createdAt: row.created_at,
  };
}

/** jsonb arrives either parsed or as text depending on the driver path. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Record<string, unknown>;
  }
  return (value ?? {}) as Record<string, unknown>;
}
