import type { SpaceId } from '@workspace/entity-id';
import { moveKnowledgeResourceInputSchema } from '@workspace/knowledge-contracts';
import type { JournaledOp, ServerWrite } from './types.js';

/**
 * Turning one journaled structural command into the server writes that carry
 * it. This is the only place that knows the op vocabulary, and it is a pure
 * function on purpose: the replay loop then has no per-op branches at all,
 * and every op's server shape is inspectable without a database.
 *
 * Two rules hold for every entry below and are what make at-least-once
 * replay safe with no dedup machinery:
 *
 *   1. Every write is idempotent — an upsert on a natural key, a patch of
 *      named columns keyed by id, or a delete that matches nothing the
 *      second time.
 *   2. A patch writes ONLY the columns its command touched, so a concurrent
 *      rename and a concurrent star on the same node both survive. That is
 *      the per-column last-write-wins the row layer is specified to have —
 *      not a whole-row overwrite that would silently revert a field the
 *      command never looked at.
 *
 * `created_by` / `user_id` are NOT taken from the op payload: they are the
 * pusher's own identity, supplied by the caller from the session. A client
 * that could name the author of a row would be asserting identity, which is
 * the server's job.
 */

export interface PushIdentity {
  /**
   * The authenticated user replaying the journal. An auth user UUID
   * (`auth.users.id`), not an entity id, so it stays a plain string.
   */
  userId: string;
}

export function planWrites(
  op: JournaledOp,
  identity: PushIdentity
): ServerWrite[] {
  const payload = op.payload;
  const spaceId = op.spaceId;

  switch (op.op) {
    case 'create_node': {
      const writes: ServerWrite[] = [
        {
          kind: 'upsert',
          table: 'knowledge_resources',
          onConflict: 'id',
          // A create that arrives twice must not overwrite edits the node
          // received in between — the second delivery is a duplicate of the
          // birth, not a statement about the node's current state.
          ignoreDuplicates: true,
          row: {
            id: str(payload['id']),
            space_id: spaceId,
            kind: str(payload['kind']),
            title: str(payload['title']),
            status: str(payload['status']),
            visibility: str(payload['visibility']),
            created_by: identity.userId,
            owner_user_id: identity.userId,
            ...(payload['body_ref'] !== undefined
              ? { body_ref: payload['body_ref'] }
              : {}),
          },
        },
      ];
      const parentId = payload['parentId'];
      if (typeof parentId === 'string' && parentId.length > 0) {
        writes.push(
          containmentEdge(
            spaceId,
            parentId,
            str(payload['id']),
            num(payload['position']),
            identity,
            payload['edgeId']
          )
        );
      }
      return writes;
    }

    case 'rename_node':
      return [patchNode(payload, { title: str(payload['title']) })];

    case 'set_status':
      return [patchNode(payload, { status: str(payload['status']) })];

    case 'set_visibility':
      return [patchNode(payload, { visibility: str(payload['visibility']) })];

    case 'trash_node':
      // The timestamp comes from the journal, not from replay time: the
      // trash happened when the user asked for it, and the server's cascade
      // stamps this same instant across the orphaned subtree so a restore
      // can still recognise the unit. `trashed_by` is the pusher's own
      // identity — a client naming someone else as the trasher would be
      // asserting authorship the server owns.
      return [
        patchNode(payload, {
          deleted_at: str(payload['deletedAt']),
          trashed_by: identity.userId,
        }),
      ];

    case 'restore_node':
      return [patchNode(payload, { deleted_at: null, trashed_by: null })];

    case 'purge_node':
      return [
        {
          kind: 'delete',
          table: 'knowledge_resources',
          match: { id: str(payload['id']) },
        },
      ];

    case 'upsert_edge':
      return [
        edgeUpsert(
          spaceId,
          str(payload['from']),
          str(payload['to']),
          str(payload['relationType']),
          num(payload['position']),
          identity
        ),
      ];

    case 'reorder_edge':
      return [
        {
          kind: 'patch',
          table: 'knowledge_edges',
          match: {
            from_id: str(payload['from']),
            to_id: str(payload['to']),
            relation_type: str(payload['relationType']),
          },
          values: { position: num(payload['position']) },
        },
      ];

    case 'remove_edge':
      return [
        {
          kind: 'delete',
          table: 'knowledge_edges',
          match: {
            from_id: str(payload['from']),
            to_id: str(payload['to']),
            relation_type: str(payload['relationType']),
          },
        },
      ];

    case 'move_node': {
      // The journal carries the contract's own shape, so the contract reads
      // it — a hand-picked field would be a second, silent schema. The space
      // comes from the payload for the same reason: it IS the input.
      const move = moveKnowledgeResourceInputSchema.parse(payload);
      return [
        {
          kind: 'rpc',
          fn: 'move_knowledge_resource',
          args: {
            p_space_id: move.spaceId,
            p_node_id: move.nodeId,
            p_target_parent_id: move.targetParentId,
            p_position: move.position,
          },
        },
      ];
    }

    case 'set_starred':
      return [
        userState(spaceId, payload, identity, {
          starred: bool(payload['starred']),
        }),
      ];

    case 'set_progress': {
      const coarse = payload['coarseStatus'];
      return [
        userState(spaceId, payload, identity, {
          progress:
            payload['progress'] === null ? null : num(payload['progress']),
          ...(typeof coarse === 'string' ? { coarse_status: coarse } : {}),
        }),
      ];
    }

    case 'mark_opened':
      // From the journal, for the same reason: `last_opened_at` orders the
      // recency lens, and replay time would sort a day of offline reading
      // into one indistinguishable instant at reconnect.
      return [
        userState(spaceId, payload, identity, {
          last_opened_at: str(payload['openedAt']),
        }),
      ];

    case 'set_description':
      return [
        {
          kind: 'upsert',
          table: 'kb_resource_description',
          onConflict: 'node_id',
          row: {
            node_id: str(payload['nodeId']),
            space_id: spaceId,
            body: str(payload['body']),
            created_by: identity.userId,
          },
        },
      ];

    default:
      // An op the planner does not know cannot be replayed, and guessing a
      // shape for it would write something nobody specified. It is a coding
      // error (a command journaled without a plan), so it fails loudly here
      // rather than silently draining out of the journal.
      throw new Error(`no server write planned for op: ${op.op}`);
  }
}

function patchNode(
  payload: Record<string, unknown>,
  values: Record<string, unknown>
): ServerWrite {
  return {
    kind: 'patch',
    table: 'knowledge_resources',
    match: { id: str(payload['id']) },
    values,
  };
}

function containmentEdge(
  spaceId: SpaceId,
  from: string,
  to: string,
  position: number,
  identity: PushIdentity,
  edgeId: unknown
): ServerWrite {
  const write = edgeUpsert(spaceId, from, to, 'contains', position, identity);
  if (write.kind === 'upsert' && typeof edgeId === 'string') {
    write.row['id'] = edgeId;
  }
  return write;
}

function edgeUpsert(
  spaceId: SpaceId,
  from: string,
  to: string,
  relationType: string,
  position: number,
  identity: PushIdentity
): ServerWrite {
  return {
    kind: 'upsert',
    table: 'knowledge_edges',
    // The natural key, not the id: two clients can mint different ids for the
    // same logical edge, and the server's own uniqueness is on this triple.
    onConflict: 'from_id,to_id,relation_type',
    row: {
      space_id: spaceId,
      from_id: from,
      to_id: to,
      relation_type: relationType,
      position,
      created_by: identity.userId,
    },
  };
}

function userState(
  spaceId: SpaceId,
  payload: Record<string, unknown>,
  identity: PushIdentity,
  values: Record<string, unknown>
): ServerWrite {
  return {
    kind: 'upsert',
    table: 'resource_user_state',
    onConflict: 'user_id,resource_id',
    row: {
      user_id: identity.userId,
      resource_id: str(payload['resourceId']),
      space_id: spaceId,
      ...values,
    },
  };
}

function str(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(
      `journaled op payload: expected a string, got ${typeof value}`
    );
  }
  return value;
}

function num(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error(
      `journaled op payload: expected a number, got ${typeof value}`
    );
  }
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(
      `journaled op payload: expected a boolean, got ${typeof value}`
    );
  }
  return value;
}
