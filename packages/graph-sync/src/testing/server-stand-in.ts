import { PGlite } from '@electric-sql/pglite';
import { describeTable, type GraphSyncTableName } from '../tables.js';
import {
  GraphWriteError,
  type GraphRowTransport,
  type PullPage,
  type RowRecord,
  type ServerWrite,
} from '../types.js';

/**
 * A real Postgres (in WASM) standing in for the shared server, exposing the
 * same `GraphRowTransport` the production PostgREST adapter implements.
 *
 * The point of the suite is the PROTOCOL, so the thing the protocol is
 * defined against has to be able to say no for real. What is reproduced,
 * trigger for trigger from the deployed schema:
 *
 *   * the containment cycle guard on `knowledge_edges`;
 *   * the soft trash cascade — trashing a folder trashes the contains-children
 *     that lose their last LIVING parent, stamped with the same instant;
 *   * `updated_at` stampers, so the watermark is the server's clock;
 *   * a visibility fence standing in for RLS: `private` rows are visible only
 *     to their owner. It is not the deployed policy set (that is the schema's
 *     own subject) — it is the smallest thing that makes access revocation
 *     and a refused write real events rather than simulated ones.
 *
 * Every session opens through `as(userId)`, so "what this user can see" is a
 * property of the connection, exactly as it is in production.
 */

const SCHEMA = `
create table knowledge_resources (
  id text primary key,
  space_id text not null,
  kind text not null,
  title text not null,
  status text not null default 'draft',
  visibility text not null default 'private',
  workflow_key text,
  body_ref jsonb,
  created_by uuid not null,
  owner_user_id uuid,
  deleted_at timestamptz,
  trashed_by uuid,
  last_modified_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table knowledge_edges (
  id text primary key,
  space_id text not null,
  from_id text not null references knowledge_resources (id) on delete cascade,
  to_id text not null references knowledge_resources (id) on delete cascade,
  relation_type text not null,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id)
);
create unique index knowledge_edges_from_to_relation_uniq
  on knowledge_edges (from_id, to_id, relation_type);

create table resource_user_state (
  id text primary key,
  user_id uuid not null,
  resource_id text not null references knowledge_resources (id) on delete cascade,
  space_id text not null,
  coarse_status text not null default 'not_started',
  progress integer check (progress is null or (progress >= 0 and progress <= 100)),
  starred boolean not null default false,
  last_opened_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_id)
);

create table kb_resource_description (
  id text primary key,
  node_id text not null unique references knowledge_resources (id) on delete cascade,
  space_id text not null,
  body text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kb_resource_link (
  id text primary key,
  node_id text not null unique references knowledge_resources (id) on delete cascade,
  space_id text not null,
  url text not null,
  host text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kb_media_blob (
  id text primary key,
  space_id text not null,
  storage_bucket text not null default 'kb-media',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text,
  duration_ms integer,
  refcount integer not null default 0,
  provenance_author_id uuid,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table kb_resource_media_meta (
  id text primary key,
  node_id text not null unique references knowledge_resources (id) on delete cascade,
  space_id text not null,
  blob_id text not null references kb_media_blob (id),
  original_filename text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at is the watermark the pull cursor runs on, so it must be the
-- SERVER's clock on every table, stamped on every update.
create function stamp_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create trigger t_knr_updated before update on knowledge_resources
  for each row execute function stamp_updated_at();
create trigger t_kne_updated before update on knowledge_edges
  for each row execute function stamp_updated_at();
create trigger t_rus_updated before update on resource_user_state
  for each row execute function stamp_updated_at();
create trigger t_krd_updated before update on kb_resource_description
  for each row execute function stamp_updated_at();
create trigger t_krl_updated before update on kb_resource_link
  for each row execute function stamp_updated_at();
create trigger t_kmb_updated before update on kb_media_blob
  for each row execute function stamp_updated_at();
create trigger t_kmm_updated before update on kb_resource_media_meta
  for each row execute function stamp_updated_at();

-- Containment acyclicity: the invariant an offline replay would otherwise
-- bypass, since a replayed move never passes the client's drop guard.
create function assert_edge_acyclic() returns trigger language plpgsql as $$
declare v_cyclic boolean;
begin
  if new.relation_type <> 'contains' then return new; end if;
  with recursive up as (
    select new.from_id as id, array[new.from_id] as seen
    union all
    select e.from_id, up.seen || e.from_id
      from knowledge_edges e join up on e.to_id = up.id
     where e.relation_type = 'contains' and not e.from_id = any (up.seen)
  )
  select exists (select 1 from up where id = new.to_id) into v_cyclic;
  if v_cyclic then
    raise exception 'knowledge_edges: containment cycle — % cannot contain %',
      new.from_id, new.to_id using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger knowledge_edges_acyclic_guard
before insert or update on knowledge_edges
for each row execute function assert_edge_acyclic();

-- Soft trash cascade: a contains-child that loses its LAST LIVING parent is
-- trashed with the SAME timestamp and actor, so a restore can recognise the
-- subtree as one unit. A child with another living parent survives.
create function cascade_trash_orphans() returns trigger language plpgsql as $$
begin
  update knowledge_resources child
     set deleted_at = new.deleted_at, trashed_by = new.trashed_by
   where child.space_id = old.space_id
     and child.deleted_at is null
     and child.id in (
       select e.to_id from knowledge_edges e
        where e.from_id = old.id and e.relation_type = 'contains'
     )
     and not exists (
       select 1 from knowledge_edges other
        join knowledge_resources p on p.id = other.from_id
       where other.to_id = child.id
         and other.relation_type = 'contains'
         and other.from_id <> old.id
         and p.deleted_at is null
     );
  return null;
end $$;

create trigger knowledge_resources_cascade_trash
after update of deleted_at on knowledge_resources
for each row when (old.deleted_at is null and new.deleted_at is not null)
execute function cascade_trash_orphans();
`;

/** Who the caller is, for the visibility fence and for write refusals. */
export interface ServerSession {
  userId: string;
}

export interface ServerStandIn {
  /** A transport bound to one user's identity — their own visible subgraph. */
  as(userId: string): GraphRowTransport;
  /** Direct (unfenced) access, for arranging a scenario's server-side state. */
  sql<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]>;
  /** Fire a change nudge to every live subscription of a space. */
  nudge(spaceId: string, kind?: 'change' | 'delete'): void;
  /** Nudges delivered so far — the degradation the poll has to cover. */
  nudgeCount(): number;
  /** Stop delivering nudges entirely. */
  dropNudges(): void;
  /** Refuse every write with an unavailability (the offline case). */
  setOffline(offline: boolean): void;
  close(): Promise<void>;
}

export async function createServerStandIn(): Promise<ServerStandIn> {
  const db = await PGlite.create();
  await db.exec(SCHEMA);

  const subscribers = new Map<
    string,
    Set<{ onChange: () => void; onDelete: () => void }>
  >();
  let nudges = 0;
  let nudgesEnabled = true;
  let offline = false;

  function nudge(spaceId: string, kind: 'change' | 'delete' = 'change') {
    if (!nudgesEnabled) return;
    for (const handlers of subscribers.get(spaceId) ?? []) {
      nudges += 1;
      if (kind === 'delete') handlers.onDelete();
      else handlers.onChange();
    }
  }

  /**
   * The stand-in's fence. Only `knowledge_resources` carries visibility, so
   * every other table is fenced THROUGH its node — which is what the deployed
   * policies do too (a satellite mirrors its node's access, an edge needs both
   * endpoints visible). `resource_user_state` is fenced by ownership of the
   * state row itself: another user's progress is never visible, ever.
   */
  function visibilityPredicate(
    table: GraphSyncTableName,
    userParam: string
  ): string {
    if (table === 'knowledge_resources') {
      return `(t.visibility <> 'private' or t.owner_user_id = ${userParam}::uuid)`;
    }
    if (table === 'resource_user_state') {
      return `t.user_id = ${userParam}::uuid`;
    }
    if (table === 'kb_media_blob') {
      // Byte records are space-scoped, not node-scoped: a blob is visible to
      // anyone who can see the space it belongs to.
      return 'true';
    }
    if (table === 'knowledge_edges') {
      return `exists (
        select 1 from knowledge_resources r
         where r.id = t.from_id and r.deleted_at is null
           and (r.visibility <> 'private' or r.owner_user_id = ${userParam}::uuid)
      ) and exists (
        select 1 from knowledge_resources r
         where r.id = t.to_id and r.deleted_at is null
           and (r.visibility <> 'private' or r.owner_user_id = ${userParam}::uuid)
      )`;
    }
    return `exists (
      select 1 from knowledge_resources r
       where r.id = t.node_id
         and (r.visibility <> 'private' or r.owner_user_id = ${userParam}::uuid)
    )`;
  }

  /**
   * A write is refused when it would touch a row the caller cannot see, or
   * when a guard trigger raises. The first check is what stands in for RLS
   * refusing an UPDATE: without it a revoked user's patch would silently
   * match zero rows and look like success.
   */
  async function guardedWrite(
    session: ServerSession,
    write: ServerWrite
  ): Promise<void> {
    if (offline) {
      throw new GraphWriteError(
        'unavailable',
        'graph write unavailable: the stand-in is offline'
      );
    }
    const descriptor = describeTable(write.table);
    if (descriptor.direction === 'down') {
      throw new GraphWriteError(
        'refused',
        `graph write refused: ${write.table} is down-only`
      );
    }

    try {
      if (write.kind === 'upsert') {
        await upsert(session, write);
        return;
      }
      const clauses = Object.keys(write.match).map(
        (column, i) => `t."${column}" = $${i + 1}`
      );
      const params = Object.values(write.match);
      const fence = visibilityPredicate(write.table, `$${params.length + 1}`);
      params.push(session.userId);

      if (write.kind === 'delete') {
        await db.query(
          `delete from ${write.table} t
            where ${clauses.join(' and ')} and ${fence}`,
          params
        );
        nudge(spaceOfWrite(write), 'delete');
        return;
      }

      const columns = Object.keys(write.values);
      const assignments = columns.map(
        (column, i) => `"${column}" = $${params.length + 1 + i}`
      );
      const { rows } = await db.query<{ id: string }>(
        `update ${write.table} t
            set ${assignments.join(', ')}
          where ${clauses.join(' and ')} and ${fence}
          returning t.id`,
        [...params, ...Object.values(write.values)]
      );
      if (rows.length === 0) {
        // Nothing matched: either the row is gone or the caller may not see
        // it. Both are a refusal — an op aimed at a row this session cannot
        // touch can never succeed, and retrying it forever would wedge the
        // journal behind it.
        throw new GraphWriteError(
          'refused',
          `graph write refused: no visible row in ${write.table}`
        );
      }
      nudge(spaceOfWrite(write));
    } catch (error) {
      throw asWriteError(error);
    }
  }

  async function upsert(
    session: ServerSession,
    write: Extract<ServerWrite, { kind: 'upsert' }>
  ): Promise<void> {
    const row = { ...write.row };
    // A per-user state row belongs to its own user: writing someone else's
    // is refused BEFORE it lands, not detected afterwards.
    if (
      write.table === 'resource_user_state' &&
      row['user_id'] !== session.userId
    ) {
      throw new GraphWriteError(
        'refused',
        'graph write refused: per-user state belongs to its own user'
      );
    }
    // An upsert onto an EXISTING row is an overwrite, so it needs the same
    // fence a patch does: the caller must be able to see what they are about
    // to replace, or a revoked user could write straight through the fence.
    await assertUpsertTargetVisible(session, write, row);
    // The server mints the row's own identity where the write is keyed by a
    // natural key (edges, per-user state, satellites): the client names the
    // logical row, the database names the physical one.
    if (!('id' in row)) row['id'] = mintId(write.table);
    const columns = Object.keys(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const conflict = write.onConflict
      .split(',')
      .map((column) => `"${column.trim()}"`)
      .join(', ');
    const assignments = columns
      .filter((column) => column !== 'id')
      .map((column) => `"${column}" = excluded."${column}"`);
    const action =
      write.ignoreDuplicates === true || assignments.length === 0
        ? 'do nothing'
        : `do update set ${assignments.join(', ')}, updated_at = clock_timestamp()`;
    await db.query(
      `insert into ${write.table} (${columns.map((c) => `"${c}"`).join(', ')})
       values (${placeholders.join(', ')})
       on conflict (${conflict}) ${action}`,
      columns.map((column) => row[column])
    );
    nudge(String(row['space_id'] ?? ''));
  }

  /**
   * Refuse an upsert whose conflict target already exists but is not visible
   * to this caller. On a real server that is RLS on the UPDATE branch of the
   * upsert; here it is one existence query against the same fence the reads
   * use, so a revoked session cannot overwrite what it can no longer read.
   */
  async function assertUpsertTargetVisible(
    session: ServerSession,
    write: Extract<ServerWrite, { kind: 'upsert' }>,
    row: Record<string, unknown>
  ): Promise<void> {
    const keys = write.onConflict.split(',').map((column) => column.trim());
    const params: unknown[] = keys.map((key) => row[key]);
    if (params.some((value) => value === undefined)) return;
    const clauses = keys.map((key, i) => `t."${key}" = $${i + 1}`);
    params.push(session.userId);
    const fence = visibilityPredicate(write.table, `$${params.length}`);
    const { rows } = await db.query<{ visible: boolean }>(
      `select (${fence}) as visible from ${write.table} t
        where ${clauses.join(' and ')}`,
      params
    );
    const existing = rows[0];
    if (existing && existing.visible === false) {
      throw new GraphWriteError(
        'refused',
        `graph write refused: no visible row in ${write.table}`
      );
    }
  }

  function transportFor(session: ServerSession): GraphRowTransport {
    return {
      async pullSince(table, spaceId, since, limit) {
        const fence = visibilityPredicate(table, '$2');
        const params: unknown[] = [spaceId, session.userId];
        let where = `t.space_id = $1 and ${fence}`;
        if (since) {
          params.push(since);
          where += ` and t.updated_at >= $${params.length}`;
        }
        params.push(limit + 1);
        const { rows } = await db.query<RowRecord>(
          `select t.* from ${table} t
            where ${where}
            order by t.updated_at asc
            limit $${params.length}`,
          params
        );
        const page: PullPage = {
          rows: rows.slice(0, limit),
          hasMore: rows.length > limit,
        };
        return page;
      },

      async inventory(table, spaceId) {
        const fence = visibilityPredicate(table, '$2');
        const { rows } = await db.query<{ id: string }>(
          `select t.id from ${table} t where t.space_id = $1 and ${fence}`,
          [spaceId, session.userId]
        );
        return rows.map((row) => row.id);
      },

      async pullByNodes(table, spaceId, nodeIds) {
        const descriptor = describeTable(table);
        if (descriptor.nodeKey === null) return [];
        const fence = visibilityPredicate(table, '$3');
        const keys = descriptor.nodeKeySecondary
          ? `(t."${descriptor.nodeKey}" = any ($2::text[]) or t."${descriptor.nodeKeySecondary}" = any ($2::text[]))`
          : `t."${descriptor.nodeKey}" = any ($2::text[])`;
        const { rows } = await db.query<RowRecord>(
          `select t.* from ${table} t
            where t.space_id = $1 and ${keys} and ${fence}`,
          [spaceId, nodeIds, session.userId]
        );
        return rows;
      },

      write: (write) => guardedWrite(session, write),

      subscribe(spaceId, handlers) {
        const set = subscribers.get(spaceId) ?? new Set();
        set.add(handlers);
        subscribers.set(spaceId, set);
        return () => set.delete(handlers);
      },
    };
  }

  return {
    as: (userId) => transportFor({ userId }),
    async sql<T>(sql: string, params?: unknown[]) {
      const { rows } = await db.query<T>(sql, params);
      return rows;
    },
    nudge,
    nudgeCount: () => nudges,
    dropNudges: () => {
      nudgesEnabled = false;
    },
    setOffline: (value) => {
      offline = value;
    },
    close: () => db.close(),
  };
}

function spaceOfWrite(write: ServerWrite): string {
  const source = write.kind === 'upsert' ? write.row : write.match;
  return String(source['space_id'] ?? '');
}

/**
 * Anything a guard trigger raises is a verdict: the server looked at the
 * write and said no. Only a `GraphWriteError` already classified as
 * unavailable travels through unchanged.
 */
function asWriteError(error: unknown): GraphWriteError {
  if (error instanceof GraphWriteError) return error;
  return new GraphWriteError(
    'refused',
    `graph write refused: ${String(error)}`,
    error
  );
}

let minted = 0;
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const PREFIXES: Record<string, string> = {
  knowledge_resources: 'knr',
  knowledge_edges: 'kne',
  resource_user_state: 'rus',
  kb_resource_description: 'krd',
  kb_resource_link: 'krl',
  kb_media_blob: 'kmb',
  kb_resource_media_meta: 'kmm',
};

/** A server-minted id, in the entity-id shape the replica's CHECK accepts. */
export function mintId(table: string): string {
  const prefix = PREFIXES[table] ?? 'knr';
  return `${prefix}_${encode(minted++, 16)}.${encode(Date.now(), 10)}`;
}

function encode(value: number, width: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < width; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}
