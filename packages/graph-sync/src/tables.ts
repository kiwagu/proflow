/**
 * The replicated tables, as one descriptor list.
 *
 * The replica carries the server's own names and column shapes — no rename
 * layer — so a descriptor is mostly a statement of WHERE the same table lives
 * on each side: the local store is one flat schema (satellites prefixed
 * `kb_`), the server keeps its satellites in a dedicated `kb` schema exposed
 * through the same PostgREST endpoint.
 *
 * `nodeKey` is the column that ties a row to a graph node. Reconciliation
 * after a refused op re-reads exactly the rows tied to the nodes that op
 * touched, and this is what makes that one loop instead of one branch per
 * table. A table without a node key (the shared media blob record) is not
 * node-scoped and is left to the ordinary watermark pull.
 *
 * `direction` is the replication contract per table: description travels both
 * ways, link and media metadata are down-only in v1. A down-only table is
 * never written by the push planner — not by policy check at runtime, but
 * because no op in the journal vocabulary targets one.
 */

export type GraphSyncTableName =
  | 'knowledge_resources'
  | 'knowledge_edges'
  | 'resource_user_state'
  | 'kb_resource_description'
  | 'kb_resource_link'
  | 'kb_media_blob'
  | 'kb_resource_media_meta';

export interface GraphSyncTableDescriptor {
  /** Table name in the local replica. */
  local: GraphSyncTableName;
  /** Postgres schema on the server (`public` or `kb`). */
  schema: 'public' | 'kb';
  /** Table name on the server, within that schema. */
  remote: string;
  /** Column tying a row to a graph node, when the table is node-scoped. */
  nodeKey: string | null;
  /**
   * A node-scoped table where ONE node can have MANY rows (edges have two
   * node columns). Reconciliation deletes local rows for the affected nodes
   * the server no longer returns; for a 1:1 satellite that is the same as an
   * id comparison, for edges it is the whole fan.
   */
  nodeKeySecondary?: string;
  direction: 'both' | 'down';
}

/**
 * In the order rows LEAVE the replica: nodes first, then what hangs off
 * them. An inventory sweep and a reconciliation evict table by table, and
 * the file tree is a live query over nodes joined to their containment
 * edge, so a node whose edge went first would show up at the top level for
 * a moment before it went too. Rows ARRIVE in the opposite order, see
 * `ARRIVAL_ORDER`.
 */
export const GRAPH_SYNC_TABLE_DESCRIPTORS: readonly GraphSyncTableDescriptor[] =
  [
    {
      local: 'knowledge_resources',
      schema: 'public',
      remote: 'knowledge_resources',
      nodeKey: 'id',
      direction: 'both',
    },
    {
      local: 'knowledge_edges',
      schema: 'public',
      remote: 'knowledge_edges',
      nodeKey: 'from_id',
      nodeKeySecondary: 'to_id',
      direction: 'both',
    },
    {
      local: 'resource_user_state',
      schema: 'public',
      remote: 'resource_user_state',
      nodeKey: 'resource_id',
      direction: 'both',
    },
    {
      local: 'kb_resource_description',
      schema: 'kb',
      remote: 'resource_description',
      nodeKey: 'node_id',
      direction: 'both',
    },
    {
      local: 'kb_resource_link',
      schema: 'kb',
      remote: 'resource_link',
      nodeKey: 'node_id',
      direction: 'down',
    },
    {
      local: 'kb_media_blob',
      schema: 'kb',
      remote: 'media_blob',
      nodeKey: null,
      direction: 'down',
    },
    {
      local: 'kb_resource_media_meta',
      schema: 'kb',
      remote: 'resource_media_meta',
      nodeKey: 'node_id',
      direction: 'down',
    },
  ] as const;

const BY_NAME = new Map(
  GRAPH_SYNC_TABLE_DESCRIPTORS.map((d) => [d.local, d] as const)
);

export function describeTable(
  table: GraphSyncTableName
): GraphSyncTableDescriptor {
  const descriptor = BY_NAME.get(table);
  if (!descriptor) throw new Error(`not a replicated table: ${table}`);
  return descriptor;
}

/**
 * In the order rows ARRIVE: edges before nodes, the rest as listed. Each
 * table lands in its own transaction and the tree re-renders in between; an
 * edge whose node has not arrived shows nothing, because the tree starts
 * from nodes, while a node whose edge has not arrived has no parent and is
 * drawn at the top level until the edge lands. The replica keeps no foreign
 * key between the two, so either order applies cleanly. This covers what
 * the server already holds together; a node the server itself holds without
 * its edge yet (the creating device writes them one after the other)
 * arrives alone whatever the order here.
 */
export const ARRIVAL_ORDER: readonly GraphSyncTableDescriptor[] = [
  ...GRAPH_SYNC_TABLE_DESCRIPTORS.filter((d) => d.local === 'knowledge_edges'),
  ...GRAPH_SYNC_TABLE_DESCRIPTORS.filter((d) => d.local !== 'knowledge_edges'),
];
