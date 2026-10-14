import { PGlite } from '@electric-sql/pglite';
import type {
  DocumentId,
  KnowledgeResourceId,
  WriterId,
} from '@workspace/entity-id';
import { DocumentNotRegisteredError } from '../errors.js';
import { parseHeadRows, parseWriterId } from '../server-rows.js';
import type { SyncHead, SyncTailRow, SyncTransport } from '../types.js';

/**
 * A real Postgres (in WASM) standing in for the shared server, exposing the
 * same `SyncTransport` the production Supabase client implements.
 *
 * The DDL and the compaction function mirror the deployed schema, guard for
 * guard — the point of these tests is the protocol, so the piece the protocol
 * is defined against has to behave for real: a per-document gap-free seq
 * assigned by the same trigger, a head that moves with it, an append-only
 * log, and a compaction that refuses to advance on a stale or
 * beyond-the-tail watermark. What is deliberately NOT reproduced is
 * authentication and row-level security: they are enforced server-side and
 * are the schema's own subject, not the sync engine's.
 */
export interface ServerStandIn extends SyncTransport {
  /** Rows currently in the update log — the compaction gauge under test. */
  updateCount(docId: DocumentId): Promise<number>;
  /** The resource the document was registered with, or null. */
  resourceIdOf(docId: DocumentId): Promise<KnowledgeResourceId | null>;
  /** Delivers a blob a second time, as an at-least-once retry would. */
  resend(
    docId: DocumentId,
    bytes: Uint8Array,
    writer: WriterId
  ): Promise<number>;
  /** Number of nudges dispatched to live subscriptions. */
  nudgeCount(): number;
  /** Number of space nudges dispatched to live space subscriptions. */
  spaceNudgeCount(): number;
  /** Stops delivering nudges: the degradation the poll has to cover. */
  dropNudges(): void;
  /**
   * Moves a document's head back in time, as a commit stamped with the
   * start of a long-waiting transaction would land.
   */
  backdate(docId: DocumentId, ms: number): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA = `
create table crdt_documents (
  id           text primary key,
  space_id     text not null,
  resource_id  text,
  snapshot     bytea,
  snapshot_seq bigint not null default 0,
  head_seq     bigint not null default 0,
  format       text not null default 'loro-snapshot-v1',
  updated_at   timestamptz not null default now()
);
create table crdt_updates (
  doc_id     text not null references crdt_documents(id) on delete cascade,
  seq        bigint not null default 0,
  bytes      bytea not null,
  writer     text not null,
  created_at timestamptz not null default now(),
  primary key (doc_id, seq)
);

-- the server's rule, guard for guard: seq is per document, assigned under
-- the document row's lock, and the head moves with it.
create function crdt_updates_assign_seq() returns trigger language plpgsql as $$
begin
  update crdt_documents d
  set head_seq = d.head_seq + 1, updated_at = now()
  where d.id = new.doc_id
  returning d.head_seq into new.seq;
  if new.seq is null then
    raise exception 'crdt document % not found', new.doc_id;
  end if;
  return new;
end $$;
create trigger crdt_updates_assign_seq
before insert on crdt_updates for each row execute function crdt_updates_assign_seq();

create function rpc_compact_document(
  p_doc_id text, p_snapshot bytea, p_covers_seq bigint
) returns boolean language plpgsql as $$
declare
  v_max_seq bigint;
  v_applied integer;
begin
  if p_snapshot is null or octet_length(p_snapshot) = 0 then
    raise exception 'snapshot must not be empty';
  end if;
  if p_covers_seq is null or p_covers_seq <= 0 then
    raise exception 'covers_seq must be positive';
  end if;

  select coalesce(max(u.seq), 0) into v_max_seq
  from crdt_updates u where u.doc_id = p_doc_id;
  if p_covers_seq > v_max_seq then
    return false;
  end if;

  update crdt_documents d
  set snapshot = p_snapshot, snapshot_seq = p_covers_seq, updated_at = now()
  where d.id = p_doc_id and d.snapshot_seq < p_covers_seq;
  get diagnostics v_applied = row_count;
  if v_applied = 0 then
    return false;
  end if;

  delete from crdt_updates u
  where u.doc_id = p_doc_id and u.seq <= p_covers_seq;
  return true;
end $$;
`;

export async function createServerStandIn(): Promise<ServerStandIn> {
  const db = await PGlite.create();
  await db.exec(SCHEMA);

  const subscribers = new Map<string, Set<() => void>>();
  const spaceSubscribers = new Map<string, Set<() => void>>();
  let nudges = 0;
  let spaceNudges = 0;
  let nudgesEnabled = true;

  function nudge(docId: DocumentId) {
    if (!nudgesEnabled) return;
    for (const cb of subscribers.get(docId) ?? []) {
      nudges += 1;
      cb();
    }
  }

  async function nudgeSpaceOf(docId: DocumentId) {
    if (!nudgesEnabled) return;
    const { rows } = await db.query<{ space_id: string }>(
      'select space_id from crdt_documents where id = $1',
      [docId]
    );
    const spaceId = rows[0]?.space_id;
    if (!spaceId) return;
    for (const cb of spaceSubscribers.get(spaceId) ?? []) {
      spaceNudges += 1;
      cb();
    }
  }

  async function insert(
    docId: DocumentId,
    bytes: Uint8Array,
    writer: WriterId
  ) {
    const { rows } = await db.query<{ seq: string }>(
      `insert into crdt_updates (doc_id, bytes, writer)
       values ($1, $2, $3) returning seq`,
      [docId, bytes, writer]
    );
    const seq = Number(rows[0]?.seq);
    nudge(docId);
    await nudgeSpaceOf(docId);
    return seq;
  }

  return {
    async ensureDocument(docId, spaceId, resourceId = null) {
      const { rows } = await db.query(
        'select 1 from crdt_documents where id = $1',
        [docId]
      );
      if (rows.length > 0) return;
      if (resourceId === null) throw new DocumentNotRegisteredError(docId);
      await db.query(
        `insert into crdt_documents (id, space_id, resource_id) values ($1, $2, $3)
         on conflict (id) do nothing`,
        [docId, spaceId, resourceId]
      );
    },

    async resourceIdOf(docId) {
      const { rows } = await db.query<{ resource_id: string | null }>(
        'select resource_id from crdt_documents where id = $1',
        [docId]
      );
      return (rows[0]?.resource_id ?? null) as KnowledgeResourceId | null;
    },

    async head(docId): Promise<SyncHead> {
      const { rows } = await db.query<{
        snapshot: Uint8Array | null;
        snapshot_seq: string;
      }>('select snapshot, snapshot_seq from crdt_documents where id = $1', [
        docId,
      ]);
      return {
        snapshot: rows[0]?.snapshot ?? null,
        snapshotSeq: Number(rows[0]?.snapshot_seq ?? 0),
      };
    },

    async tail(docId, afterSeq): Promise<SyncTailRow[]> {
      const { rows } = await db.query<{
        seq: string;
        bytes: Uint8Array;
        writer: string;
      }>(
        `select seq, bytes, writer from crdt_updates
         where doc_id = $1 and seq > $2 order by seq`,
        [docId, afterSeq]
      );
      // Through the same parser as the production transport.
      return rows.map((r) => ({
        seq: Number(r.seq),
        bytes: r.bytes,
        writer: parseWriterId(r.writer),
      }));
    },

    pushUpdate: insert,
    resend: insert,

    async tailCount(docId) {
      const { rows } = await db.query<{ n: number }>(
        'select count(*)::int as n from crdt_updates where doc_id = $1',
        [docId]
      );
      return rows[0]?.n ?? 0;
    },

    async updateCount(docId) {
      const { rows } = await db.query<{ n: number }>(
        'select count(*)::int as n from crdt_updates where doc_id = $1',
        [docId]
      );
      return rows[0]?.n ?? 0;
    },

    async compact(docId, snapshot, coversSeq) {
      const { rows } = await db.query<{ rpc_compact_document: boolean }>(
        'select rpc_compact_document($1, $2, $3)',
        [docId, snapshot, coversSeq]
      );
      const accepted = rows[0]?.rpc_compact_document === true;
      if (accepted) await nudgeSpaceOf(docId);
      return accepted;
    },

    async heads(spaceId, since, limit, offset) {
      const { rows } = await db.query<{
        id: string;
        head_seq: string;
        updated_at: string | Date;
      }>(
        `select id, head_seq, updated_at from crdt_documents
         where space_id = $1 and ($2::timestamptz is null or updated_at >= $2)
         order by updated_at, id
         limit $3 offset $4`,
        [spaceId, since, limit + 1, offset]
      );
      return {
        ...parseHeadRows(rows.slice(0, limit)),
        hasMore: rows.length > limit,
      };
    },

    subscribeSpace(spaceId, onNudge) {
      const set = spaceSubscribers.get(spaceId) ?? new Set();
      set.add(onNudge);
      spaceSubscribers.set(spaceId, set);
      return () => set.delete(onNudge);
    },

    subscribeInserts(docId, onNudge) {
      const set = subscribers.get(docId) ?? new Set();
      set.add(onNudge);
      subscribers.set(docId, set);
      return () => set.delete(onNudge);
    },

    nudgeCount: () => nudges,
    spaceNudgeCount: () => spaceNudges,
    dropNudges: () => {
      nudgesEnabled = false;
    },
    async backdate(docId, ms) {
      await db.query(
        `update crdt_documents
         set updated_at = updated_at - make_interval(secs => $2::double precision / 1000)
         where id = $1`,
        [docId, ms]
      );
    },
    close: () => db.close(),
  };
}
