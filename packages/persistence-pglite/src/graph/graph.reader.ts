import type { Unsubscribe } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';
import {
  GRAPH_EDGE_COLUMNS,
  GRAPH_NODE_COLUMNS,
  type GraphEdgeRow,
  graphNodeColumns,
  type GraphNodeRow,
  type KbAttributeRow,
  toGraphEdge,
  toGraphNode,
  toKbAttributes,
  toUserResourceState,
  type UserStateRow,
} from './graph.mapper.js';
import type {
  GraphEdge,
  GraphNode,
  KbAttributes,
  LifecycleScope,
  ResourceTag,
  UserResourceState,
} from './graph.types.js';

/**
 * The workbench read vocabulary — one local equivalent per server fan-out the
 * `/author/graph/*` surface makes today. Every entry is a live query: it
 * delivers now and again on every change to the rows it reads, so a view
 * subscribes once instead of re-fetching.
 *
 * Two shapes per question, deliberately:
 *
 *   * `watchX` — the live subscription a view holds open;
 *   * `readX`  — the same query answered once, for a command that needs the
 *     current rows (a drop guard, a bulk action) without a subscription.
 *
 * Everything is scoped to one space. Access is NOT decided here: the replica
 * only ever holds rows the server already showed this user (the pull runs
 * under their identity), so a query can only narrow that set, never widen it.
 */
export interface GraphReader {
  /**
   * The nodes of a space in one existence lens. `live` is normal browse
   * (`deleted_at is null`); `trashed` is the Trash lens. Tag nodes are
   * included — they are ordinary nodes, and the facet reads them from here.
   */
  watchNodes(
    spaceId: string,
    scope: LifecycleScope,
    cb: (nodes: GraphNode[]) => void
  ): Unsubscribe;
  readNodes(spaceId: string, scope: LifecycleScope): Promise<GraphNode[]>;

  /** One node by id, or null when it is not in the replica. */
  readNode(nodeId: string): Promise<GraphNode | null>;

  /**
   * Every edge of one relation in a space, ordered by `position` — the
   * containment forest (`contains`), the shortcut forest (`shortcut`), or any
   * other relation the views browse. The forest itself is built by the caller
   * from these rows, exactly as the server fan-out returns them today.
   */
  watchEdges(
    spaceId: string,
    relationType: string,
    cb: (edges: GraphEdge[]) => void
  ): Unsubscribe;
  readEdges(spaceId: string, relationType: string): Promise<GraphEdge[]>;

  /**
   * The ancestor chain of a node, nearest-first, walked over `contains` edges
   * in the replica. The recursive CTE is the same shape the server resolver
   * runs — the reason the store had to be real Postgres. Cycle-safe: a node
   * already on the path stops the walk.
   */
  readAncestors(nodeId: string): Promise<GraphNode[]>;

  /**
   * The whole `contains` subtree under a node (excluding the node itself).
   * Backs the drop guard (a folder may not be dropped into its own subtree)
   * and the optimistic gray-out of a trashed subtree.
   */
  readDescendantIds(nodeId: string): Promise<string[]>;

  /**
   * All tag nodes of a space (`kind='tag'`, live), title-ordered — the
   * vocabulary the tag facet and the panel's tag tray read.
   */
  watchSpaceTags(spaceId: string, cb: (tags: ResourceTag[]) => void): Unsubscribe;

  /**
   * The tags OF each node in a space: `node id → its tag nodes`, resolved over
   * FORWARD `tagged` edges. A tag whose node is trashed or absent from the
   * replica drops out, the same narrowing the server fan-out applies.
   */
  watchResourceTags(
    spaceId: string,
    cb: (tagsByNode: Record<string, ResourceTag[]>) => void
  ): Unsubscribe;

  /**
   * The KB satellite attributes of every node in a space:
   * `node id → attributes`. One query joins description, link and the media
   * reference to its shared blob row — replacing four batched server reads.
   * A node with no satellite carries no entry.
   */
  watchKbAttributes(
    spaceId: string,
    cb: (attributesByNode: Record<string, KbAttributes>) => void
  ): Unsubscribe;

  /**
   * The current user's per-resource state in a space: `resource id → state`.
   * Own rows only by construction (the replica is per-user), so this needs no
   * user filter. Drives starred, coarse progress and the "Recent" ordering.
   */
  watchUserState(
    spaceId: string,
    cb: (stateByResource: Record<string, UserResourceState>) => void
  ): Unsubscribe;

  /** The current user's starred resource ids in a space. */
  watchStarredIds(spaceId: string, cb: (ids: string[]) => void): Unsubscribe;

  /**
   * Title search over the space's live nodes — the local equivalent of the
   * lexical search route. Prefix-matched on the `simple` configuration, so a
   * partially typed word matches, with an exact substring fallback for terms
   * the tokenizer splits differently. Ranked, capped at `limit`.
   */
  searchByTitle(
    spaceId: string,
    term: string,
    limit?: number
  ): Promise<GraphNode[]>;
}

/** Default cap on a title search, mirroring the server route's default. */
export const GRAPH_SEARCH_DEFAULT_LIMIT = 20;

const LIFECYCLE_PREDICATE: Record<LifecycleScope, string> = {
  live: 'deleted_at is null',
  trashed: 'deleted_at is not null',
};

/**
 * The satellite join, written once. `left join` throughout: the attributes are
 * optional and a node with none must still be reachable by its own row when a
 * caller asks for it. The media branch requires BOTH the reference and its
 * blob — a reference whose blob is not in the replica yields no attribute
 * rather than a half-filled one.
 */
const KB_ATTRIBUTES_SQL = `select r.id as node_id,
          d.body as description,
          l.url as link_url,
          l.host as link_host,
          m.original_filename as media_original_filename,
          b.storage_path as media_storage_path,
          b.mime_type as media_mime_type,
          b.size_bytes as media_size_bytes,
          b.duration_ms as media_duration_ms
     from knowledge_resources r
     left join kb_resource_description d on d.node_id = r.id
     left join kb_resource_link l on l.node_id = r.id
     left join kb_resource_media_meta m on m.node_id = r.id
     left join kb_media_blob b on b.id = m.blob_id
    where r.space_id = $1
      and (d.id is not null or l.id is not null or b.id is not null)`;

export function createPgliteGraphReader(db: AppDb): GraphReader {
  const nodesSql = (scope: LifecycleScope) =>
    `select ${GRAPH_NODE_COLUMNS}
       from knowledge_resources
      where space_id = $1 and ${LIFECYCLE_PREDICATE[scope]}
      order by lower(title), id`;

  const edgesSql = `select ${GRAPH_EDGE_COLUMNS}
       from knowledge_edges
      where space_id = $1 and relation_type = $2
      order by "position", id`;

  return {
    watchNodes(spaceId, scope, cb) {
      return watchQuery<GraphNodeRow>(db, nodesSql(scope), [spaceId], (rows) =>
        cb(rows.map(toGraphNode))
      );
    },

    async readNodes(spaceId, scope) {
      const { rows } = await db.query<GraphNodeRow>(nodesSql(scope), [spaceId]);
      return rows.map(toGraphNode);
    },

    async readNode(nodeId) {
      const { rows } = await db.query<GraphNodeRow>(
        `select ${GRAPH_NODE_COLUMNS} from knowledge_resources where id = $1`,
        [nodeId]
      );
      return rows[0] ? toGraphNode(rows[0]) : null;
    },

    watchEdges(spaceId, relationType, cb) {
      return watchQuery<GraphEdgeRow>(
        db,
        edgesSql,
        [spaceId, relationType],
        (rows) => cb(rows.map(toGraphEdge))
      );
    },

    async readEdges(spaceId, relationType) {
      const { rows } = await db.query<GraphEdgeRow>(edgesSql, [
        spaceId,
        relationType,
      ]);
      return rows.map(toGraphEdge);
    },

    async readAncestors(nodeId) {
      const { rows } = await db.query<GraphNodeRow & { depth: number }>(
        `with recursive up as (
           select $1::text as id, 0 as depth, array[$1::text] as seen
           union all
           select e.from_id, up.depth + 1, up.seen || e.from_id
             from knowledge_edges e
             join up on e.to_id = up.id
            where e.relation_type = 'contains'
              and not e.from_id = any (up.seen)
         )
         select ${graphNodeColumns('r')}, up.depth
           from up
           join knowledge_resources r on r.id = up.id
          where up.depth > 0
          order by up.depth`,
        [nodeId]
      );
      return rows.map(toGraphNode);
    },

    async readDescendantIds(nodeId) {
      const { rows } = await db.query<{ id: string }>(
        `with recursive down as (
           select $1::text as id, array[$1::text] as seen
           union all
           select e.to_id, down.seen || e.to_id
             from knowledge_edges e
             join down on e.from_id = down.id
            where e.relation_type = 'contains'
              and not e.to_id = any (down.seen)
         )
         select id from down where id <> $1`,
        [nodeId]
      );
      return rows.map((row) => row.id);
    },

    watchSpaceTags(spaceId, cb) {
      return watchQuery<{ id: string; title: string }>(
        db,
        `select id, title
           from knowledge_resources
          where space_id = $1 and kind = 'tag' and deleted_at is null
          order by lower(title), id`,
        [spaceId],
        cb
      );
    },

    watchResourceTags(spaceId, cb) {
      return watchQuery<{ from_id: string; id: string; title: string }>(
        db,
        `select e.from_id, t.id, t.title
           from knowledge_edges e
           join knowledge_resources t on t.id = e.to_id
          where e.space_id = $1
            and e.relation_type = 'tagged'
            and t.kind = 'tag'
            and t.deleted_at is null
          order by lower(t.title), t.id`,
        [spaceId],
        (rows) => {
          const byNode: Record<string, ResourceTag[]> = {};
          for (const row of rows) {
            (byNode[row.from_id] ??= []).push({ id: row.id, title: row.title });
          }
          cb(byNode);
        }
      );
    },

    watchKbAttributes(spaceId, cb) {
      return watchQuery<KbAttributeRow>(
        db,
        KB_ATTRIBUTES_SQL,
        [spaceId],
        (rows) => {
          const byNode: Record<string, KbAttributes> = {};
          for (const row of rows) byNode[row.node_id] = toKbAttributes(row);
          cb(byNode);
        }
      );
    },

    watchUserState(spaceId, cb) {
      return watchQuery<UserStateRow>(
        db,
        `select resource_id, coarse_status, progress, starred, last_opened_at
           from resource_user_state
          where space_id = $1`,
        [spaceId],
        (rows) => {
          const byResource: Record<string, UserResourceState> = {};
          for (const row of rows) {
            byResource[row.resource_id] = toUserResourceState(row);
          }
          cb(byResource);
        }
      );
    },

    watchStarredIds(spaceId, cb) {
      return watchQuery<{ resource_id: string }>(
        db,
        `select resource_id from resource_user_state
          where space_id = $1 and starred
          order by resource_id`,
        [spaceId],
        (rows) => cb(rows.map((row) => row.resource_id))
      );
    },

    async searchByTitle(spaceId, term, limit = GRAPH_SEARCH_DEFAULT_LIMIT) {
      const trimmed = term.trim();
      if (trimmed === '') return [];
      // Prefix query over the `simple` configuration: every whitespace-run
      // becomes a prefix term, so "prod des" matches "Product Design" while
      // the user is still typing. `websearch_to_tsquery` is deliberately not
      // used — it has no prefix operator, which is the whole point here.
      const prefixQuery = trimmed
        .split(/\s+/)
        .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & ');
      const { rows } = await db.query<GraphNodeRow>(
        `select ${GRAPH_NODE_COLUMNS}
           from knowledge_resources
          where space_id = $1
            and deleted_at is null
            and (
              ($2 <> '' and to_tsvector('simple', title) @@ to_tsquery('simple', $2))
              -- Substring fallback: catches what the tokenizer splits away
              -- (punctuation runs, mid-word matches) so a visible title can
              -- never be unfindable by typing part of it.
              or title ilike '%' || $3 || '%'
            )
          order by
            ts_rank(to_tsvector('simple', title), to_tsquery('simple', nullif($2, ''))) desc nulls last,
            lower(title), id
          limit $4`,
        [spaceId, prefixQuery, trimmed, limit]
      );
      return rows.map(toGraphNode);
    },
  };
}
