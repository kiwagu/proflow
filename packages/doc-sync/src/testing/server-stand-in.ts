import { PGlite } from '@electric-sql/pglite';
import type { SyncHead, SyncTailRow, SyncTransport } from '../types.js';

/**
 * A real Postgres (in WASM) standing in for the shared server, exposing the
 * same `SyncTransport` the production Supabase client implements.
 *
 * The DDL and the compaction function mirror the deployed schema, guard for
 * guard — the point of these tests is the protocol, so the piece the protocol
 * is defined against has to behave for real: server-assigned identity seq,
 * an append-only log, and a compaction that refuses to advance on a stale or
 * beyond-the-tail watermark. What is deliberately NOT reproduced is
 * authentication and row-level security: they are enforced server-side and
 * are the schema's own subject, not the sync engine's.
 */
export interface ServerStandIn extends SyncTransport {
  /** Rows currently in the update log — the compaction gauge under test. */
  updateCount(docId: string): Promise<number>;
  /** Delivers a blob a second time, as an at-least-once retry would. */
  resend(docId: string, bytes: Uint8Array, writer: string): Promise<number>;
  /** Number of nudges dispatched to live subscriptions. */
  nudgeCount(): number;
  /** Stops delivering nudges: the degradation the poll has to cover. */
  dropNudges(): void;
  close(): Promise<void>;
}

const SCHEMA = `
create table crdt_documents (
  id           text primary key,
  space_id     text not null,
  snapshot     bytea,
  snapshot_seq bigint not null default 0,
  format       text not null default 'loro-snapshot-v1',
  updated_at   timestamptz not null default now()
);
create table crdt_updates (
  doc_id     text not null references crdt_documents(id) on delete cascade,
  seq        bigint generated always as identity,
  bytes      bytea not null,
  writer     text not null,
  created_at timestamptz not null default now(),
  primary key (doc_id, seq)
);

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
  let nudges = 0;
  let nudgesEnabled = true;

  function nudge(docId: string) {
    if (!nudgesEnabled) return;
    for (const cb of subscribers.get(docId) ?? []) {
      nudges += 1;
      cb();
    }
  }

  async function insert(docId: string, bytes: Uint8Array, writer: string) {
    const { rows } = await db.query<{ seq: string }>(
      `insert into crdt_updates (doc_id, bytes, writer)
       values ($1, $2, $3) returning seq`,
      [docId, bytes, writer]
    );
    const seq = Number(rows[0]?.seq);
    nudge(docId);
    return seq;
  }

  return {
    async ensureDocument(docId, spaceId) {
      await db.query(
        `insert into crdt_documents (id, space_id) values ($1, $2)
         on conflict (id) do nothing`,
        [docId, spaceId]
      );
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
      return rows.map((r) => ({
        seq: Number(r.seq),
        bytes: r.bytes,
        writer: r.writer,
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
      return rows[0]?.rpc_compact_document === true;
    },

    subscribeInserts(docId, onNudge) {
      const set = subscribers.get(docId) ?? new Set();
      set.add(onNudge);
      subscribers.set(docId, set);
      return () => set.delete(onNudge);
    },

    nudgeCount: () => nudges,
    dropNudges: () => {
      nudgesEnabled = false;
    },
    close: () => db.close(),
  };
}
