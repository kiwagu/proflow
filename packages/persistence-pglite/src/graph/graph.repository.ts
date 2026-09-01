import { newId } from '@workspace/domain';
import { err, ok, type Result } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import { GRAPH_NODE_COLUMNS, type GraphNodeRow, toGraphNode } from './graph.mapper.js';
import type { GraphNode, ResourceFloor } from './graph.types.js';

/**
 * The workbench write path. Every structural command does exactly two things
 * in ONE local transaction:
 *
 *   1. writes the replica, so the workbench is responsive and works offline;
 *   2. appends the command to `graph_op_journal`, so the intent survives a
 *      tab close and a sync worker can replay it against the server.
 *
 * The local write is a PROPOSAL, never the truth: the server is the sole
 * authority for graph rows, and the replica converges to it. If the server
 * refuses an op (access, the trash guard, the cycle check), reconciliation
 * drops that op and every journaled op touching the same node and re-pulls
 * those rows — the pull IS the rollback, so there is no local undo log here.
 *
 * Every op is idempotent by construction (upsert by client-minted id, column
 * patch keyed by id, edge upsert on the natural key, timestamp write, delete
 * by id), which is what makes at-least-once replay safe without dedup
 * machinery.
 */

/** The op vocabulary the journal carries, one entry per structural command. */
export const GRAPH_OPS = {
  createNode: 'create_node',
  renameNode: 'rename_node',
  setStatus: 'set_status',
  setVisibility: 'set_visibility',
  setStarred: 'set_starred',
  setProgress: 'set_progress',
  markOpened: 'mark_opened',
  upsertEdge: 'upsert_edge',
  removeEdge: 'remove_edge',
  reorderEdge: 'reorder_edge',
  trashNode: 'trash_node',
  restoreNode: 'restore_node',
  purgeNode: 'purge_node',
  setDescription: 'set_description',
} as const;

export type GraphOpKind = (typeof GRAPH_OPS)[keyof typeof GRAPH_OPS];

export type CreateNodeInput = {
  spaceId: string;
  kind: string;
  title: string;
  createdBy: string;
  /** Client-minted so the card renders before the write lands. */
  id?: string;
  status?: string;
  visibility?: ResourceFloor;
  ownerUserId?: string | null;
  /** Optional container: creates the `contains` edge in the same transaction. */
  parentId?: string | null;
  position?: number;
};

export type UpsertEdgeInput = {
  spaceId: string;
  from: string;
  to: string;
  relationType: string;
  createdBy: string;
  id?: string;
  position?: number;
};

/** Structural commands over the local replica. Every method journals its op. */
export interface GraphRepository {
  createNode(input: CreateNodeInput): Promise<Result<GraphNode, string>>;
  renameNode(nodeId: string, title: string): Promise<Result<void, string>>;
  setStatus(nodeId: string, status: string): Promise<Result<void, string>>;
  setVisibility(
    nodeId: string,
    visibility: ResourceFloor
  ): Promise<Result<void, string>>;
  setDescription(
    nodeId: string,
    body: string,
    createdBy: string
  ): Promise<Result<void, string>>;
  /**
   * Move or link: upserts the edge on its natural key `(from, to, relation)`,
   * so a redelivered op writes the same row rather than a duplicate.
   */
  upsertEdge(input: UpsertEdgeInput): Promise<Result<void, string>>;
  removeEdge(
    spaceId: string,
    from: string,
    to: string,
    relationType: string
  ): Promise<Result<void, string>>;
  /** Reorder within a container: a position write on an existing edge. */
  reorderEdge(
    spaceId: string,
    from: string,
    to: string,
    relationType: string,
    position: number
  ): Promise<Result<void, string>>;
  /**
   * Trash a node. Only the node's own columns are written locally: the
   * server's cascade trigger over the containment subtree is the authority,
   * and the replica mirrors its outcome after the next pull rather than
   * reimplementing the cascade.
   */
  trashNode(nodeId: string, trashedBy: string): Promise<Result<void, string>>;
  restoreNode(nodeId: string): Promise<Result<void, string>>;
  /** Purge: a real delete, locally and (on replay) on the server. */
  purgeNode(nodeId: string): Promise<Result<void, string>>;
  setStarred(
    spaceId: string,
    resourceId: string,
    userId: string,
    starred: boolean
  ): Promise<Result<void, string>>;
  setProgress(
    spaceId: string,
    resourceId: string,
    userId: string,
    progress: number | null,
    coarseStatus?: string
  ): Promise<Result<void, string>>;
  markOpened(
    spaceId: string,
    resourceId: string,
    userId: string
  ): Promise<Result<void, string>>;
}

type Tx = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

/** Append one command to the journal. Always inside the command's transaction. */
async function journal(
  tx: Tx,
  spaceId: string,
  op: GraphOpKind,
  payload: Record<string, unknown>,
  nodeIds: string[]
): Promise<void> {
  await tx.query(
    `insert into graph_op_journal (space_id, op, payload, node_ids)
     values ($1, $2, $3::jsonb, $4)`,
    [spaceId, op, JSON.stringify(payload), nodeIds]
  );
}

export function createPgliteGraphRepository(db: AppDb): GraphRepository {
  /**
   * Run a command's local write and its journal append as one unit. The two
   * must not come apart: a replica row without its journal entry is a change
   * that would never reach the server, and a journal entry without its row is
   * an intent the user cannot see.
   */
  async function command(
    label: string,
    run: (tx: Tx) => Promise<void>
  ): Promise<Result<void, string>> {
    try {
      await db.transaction(async (tx) => {
        await run(tx as unknown as Tx);
      });
      return ok(undefined);
    } catch (e) {
      return err(`${label} failed: ${String(e)}`);
    }
  }

  /**
   * The per-user state row a star/progress/open command writes. Minted with
   * the client id contract like every other row, and upserted on
   * `(user_id, resource_id)` so a redelivery patches instead of duplicating.
   */
  async function upsertUserState(
    tx: Tx,
    spaceId: string,
    resourceId: string,
    userId: string,
    columns: string,
    values: unknown[]
  ): Promise<void> {
    await tx.query(
      `insert into resource_user_state (id, user_id, resource_id, space_id, ${columns})
       values ($1, $2, $3, $4${values.map((_, i) => `, $${i + 5}`).join('')})
       on conflict (user_id, resource_id) do update
         set ${columns
           .split(', ')
           .map((column) => `${column} = excluded.${column}`)
           .join(', ')},
             updated_at = now()`,
      [newId('resourceUserState'), userId, resourceId, spaceId, ...values]
    );
  }

  return {
    async createNode(input) {
      const id = input.id ?? newId('knowledgeResource');
      const edgeId = input.parentId ? newId('knowledgeEdge') : null;
      try {
        await db.transaction(async (raw) => {
          const tx = raw as unknown as Tx;
          await tx.query(
            `insert into knowledge_resources
               (id, space_id, kind, title, status, visibility, created_by, owner_user_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (id) do nothing`,
            [
              id,
              input.spaceId,
              input.kind,
              input.title,
              input.status ?? 'draft',
              input.visibility ?? 'private',
              input.createdBy,
              input.ownerUserId ?? input.createdBy,
            ]
          );
          if (input.parentId && edgeId) {
            await tx.query(
              `insert into knowledge_edges
                 (id, space_id, from_id, to_id, relation_type, "position", created_by)
               values ($1, $2, $3, $4, 'contains', $5, $6)
               on conflict (from_id, to_id, relation_type) do update
                 set "position" = excluded."position", updated_at = now()`,
              [
                edgeId,
                input.spaceId,
                input.parentId,
                id,
                input.position ?? 0,
                input.createdBy,
              ]
            );
          }
          await journal(
            tx,
            input.spaceId,
            GRAPH_OPS.createNode,
            {
              id,
              kind: input.kind,
              title: input.title,
              status: input.status ?? 'draft',
              visibility: input.visibility ?? 'private',
              ownerUserId: input.ownerUserId ?? input.createdBy,
              parentId: input.parentId ?? null,
              position: input.position ?? 0,
              edgeId,
            },
            input.parentId ? [id, input.parentId] : [id]
          );
        });
      } catch (e) {
        return err(`graph.createNode failed: ${String(e)}`);
      }
      const { rows } = await db.query<GraphNodeRow>(
        `select ${GRAPH_NODE_COLUMNS} from knowledge_resources where id = $1`,
        [id]
      );
      return rows[0]
        ? ok(toGraphNode(rows[0]))
        : err('graph.createNode: insert returned no row');
    },

    renameNode(nodeId, title) {
      return command('graph.renameNode', async (tx) => {
        const rows = await patchNode(tx, nodeId, 'title = $2', [title]);
        await journal(
          tx,
          spaceOf(rows),
          GRAPH_OPS.renameNode,
          { id: nodeId, title },
          [nodeId]
        );
      });
    },

    setStatus(nodeId, status) {
      return command('graph.setStatus', async (tx) => {
        const rows = await patchNode(tx, nodeId, 'status = $2', [status]);
        await journal(
          tx,
          spaceOf(rows),
          GRAPH_OPS.setStatus,
          { id: nodeId, status },
          [nodeId]
        );
      });
    },

    setVisibility(nodeId, visibility) {
      return command('graph.setVisibility', async (tx) => {
        const rows = await patchNode(tx, nodeId, 'visibility = $2', [visibility]);
        await journal(
          tx,
          spaceOf(rows),
          GRAPH_OPS.setVisibility,
          { id: nodeId, visibility },
          [nodeId]
        );
      });
    },

    setDescription(nodeId, body, createdBy) {
      return command('graph.setDescription', async (tx) => {
        const { rows } = await tx.query(
          'select space_id from knowledge_resources where id = $1',
          [nodeId]
        );
        const spaceId = spaceOf(rows);
        await tx.query(
          `insert into kb_resource_description (id, node_id, space_id, body, created_by)
           values ($1, $2, $3, $4, $5)
           on conflict (node_id) do update
             set body = excluded.body, updated_at = now()`,
          [newId('kbResourceDescription'), nodeId, spaceId, body, createdBy]
        );
        // The description feeds the edit-recency roll-up server-side; mirror
        // that locally so the "Modified" column does not go backwards until
        // the next pull.
        await tx.query(
          'update knowledge_resources set last_modified_at = now() where id = $1',
          [nodeId]
        );
        await journal(
          tx,
          spaceId,
          GRAPH_OPS.setDescription,
          { nodeId, body },
          [nodeId]
        );
      });
    },

    upsertEdge(input) {
      return command('graph.upsertEdge', async (tx) => {
        // Containment must stay acyclic. The client guard is a courtesy, not
        // the fence — an offline push bypasses it entirely, so the server's
        // own cycle guard is the authority; refusing here only spares the
        // user a change that would be reconciled away on reconnect.
        if (input.relationType === 'contains') {
          const { rows } = await tx.query(
            `with recursive up as (
               select $1::text as id, array[$1::text] as seen
               union all
               select e.from_id, up.seen || e.from_id
                 from knowledge_edges e
                 join up on e.to_id = up.id
                where e.relation_type = 'contains'
                  and not e.from_id = any (up.seen)
             )
             select 1 from up where id = $2 limit 1`,
            [input.from, input.to]
          );
          if (rows.length > 0) {
            throw new Error('cannot contain a node inside its own subtree');
          }
        }
        await tx.query(
          `insert into knowledge_edges
             (id, space_id, from_id, to_id, relation_type, "position", created_by)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (from_id, to_id, relation_type) do update
             set "position" = excluded."position", updated_at = now()`,
          [
            input.id ?? newId('knowledgeEdge'),
            input.spaceId,
            input.from,
            input.to,
            input.relationType,
            input.position ?? 0,
            input.createdBy,
          ]
        );
        await journal(
          tx,
          input.spaceId,
          GRAPH_OPS.upsertEdge,
          {
            from: input.from,
            to: input.to,
            relationType: input.relationType,
            position: input.position ?? 0,
          },
          [input.from, input.to]
        );
      });
    },

    removeEdge(spaceId, from, to, relationType) {
      return command('graph.removeEdge', async (tx) => {
        await tx.query(
          `delete from knowledge_edges
            where from_id = $1 and to_id = $2 and relation_type = $3`,
          [from, to, relationType]
        );
        await journal(
          tx,
          spaceId,
          GRAPH_OPS.removeEdge,
          { from, to, relationType },
          [from, to]
        );
      });
    },

    reorderEdge(spaceId, from, to, relationType, position) {
      return command('graph.reorderEdge', async (tx) => {
        await tx.query(
          `update knowledge_edges set "position" = $4, updated_at = now()
            where from_id = $1 and to_id = $2 and relation_type = $3`,
          [from, to, relationType, position]
        );
        await journal(
          tx,
          spaceId,
          GRAPH_OPS.reorderEdge,
          { from, to, relationType, position },
          [from, to]
        );
      });
    },

    trashNode(nodeId, trashedBy) {
      return command('graph.trashNode', async (tx) => {
        const rows = await patchNode(
          tx,
          nodeId,
          'deleted_at = now(), trashed_by = $2',
          [trashedBy]
        );
        await journal(tx, spaceOf(rows), GRAPH_OPS.trashNode, { id: nodeId }, [
          nodeId,
        ]);
      });
    },

    restoreNode(nodeId) {
      return command('graph.restoreNode', async (tx) => {
        const rows = await patchNode(
          tx,
          nodeId,
          'deleted_at = null, trashed_by = null',
          []
        );
        await journal(tx, spaceOf(rows), GRAPH_OPS.restoreNode, { id: nodeId }, [
          nodeId,
        ]);
      });
    },

    purgeNode(nodeId) {
      return command('graph.purgeNode', async (tx) => {
        const { rows } = await tx.query(
          'delete from knowledge_resources where id = $1 returning space_id',
          [nodeId]
        );
        const spaceId = spaceOf(rows);
        // No foreign keys hold the replica together (pull batches per table
        // are independent), so the edges of a purged node are removed here
        // rather than by a cascade.
        await tx.query(
          'delete from knowledge_edges where from_id = $1 or to_id = $1',
          [nodeId]
        );
        await journal(tx, spaceId, GRAPH_OPS.purgeNode, { id: nodeId }, [nodeId]);
      });
    },

    setStarred(spaceId, resourceId, userId, starred) {
      return command('graph.setStarred', async (tx) => {
        await upsertUserState(tx, spaceId, resourceId, userId, 'starred', [
          starred,
        ]);
        await journal(
          tx,
          spaceId,
          GRAPH_OPS.setStarred,
          { resourceId, starred },
          [resourceId]
        );
      });
    },

    setProgress(spaceId, resourceId, userId, progress, coarseStatus) {
      return command('graph.setProgress', async (tx) => {
        const columns =
          coarseStatus === undefined ? 'progress' : 'progress, coarse_status';
        const values =
          coarseStatus === undefined ? [progress] : [progress, coarseStatus];
        await upsertUserState(tx, spaceId, resourceId, userId, columns, values);
        await journal(
          tx,
          spaceId,
          GRAPH_OPS.setProgress,
          { resourceId, progress, coarseStatus: coarseStatus ?? null },
          [resourceId]
        );
      });
    },

    markOpened(spaceId, resourceId, userId) {
      return command('graph.markOpened', async (tx) => {
        await upsertUserState(
          tx,
          spaceId,
          resourceId,
          userId,
          'last_opened_at',
          [new Date()]
        );
        // Opens count as activity but NOT as an edit — `last_modified_at` is
        // deliberately untouched, the same split the server roll-up makes.
        await tx.query(
          'update knowledge_resources set last_activity_at = now() where id = $1',
          [resourceId]
        );
        await journal(tx, spaceId, GRAPH_OPS.markOpened, { resourceId }, [
          resourceId,
        ]);
      });
    },
  };
}

/**
 * Patch a node's columns and return its space. A command that names a node
 * absent from the replica is a bug in the caller, not a state to tolerate:
 * the journal entry needs a space, and inventing one would send the op to
 * the wrong place.
 */
async function patchNode(
  tx: Tx,
  nodeId: string,
  assignment: string,
  params: unknown[]
): Promise<unknown[]> {
  const { rows } = await tx.query(
    `update knowledge_resources
        set ${assignment}, last_modified_at = now(), updated_at = now()
      where id = $1
      returning space_id`,
    [nodeId, ...params]
  );
  return rows;
}

function spaceOf(rows: unknown[]): string {
  const spaceId = (rows[0] as { space_id?: string } | undefined)?.space_id;
  if (spaceId === undefined) throw new Error('node not in the local replica');
  return spaceId;
}
