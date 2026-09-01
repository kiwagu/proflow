import type {
  BlobInfo,
  BlobSyncRecord,
  IBlobSyncLocal,
} from '@workspace/domain';
import type { AppDb } from '../db/db.js';

/**
 * The local half of media sync, over the `blob` table's `sync_state` column.
 *
 * The column has been a reserved seam since the files schema landed; this is
 * the first code that gives it behavior. Only two values are ever written —
 * `'local'` and `'synced'` — and the transition is one-way per content hash,
 * because content addressing means the bytes behind a hash never change: once
 * a durable copy of them exists it stays valid forever.
 *
 * Everything here is idempotent by hash, so the reconcile loop above can be
 * interrupted and re-run at any point without bookkeeping.
 */

type BlobRow = {
  hash: string;
  size: string | number;
  mime: string;
  sync_state: string;
};

function toRecord(row: BlobRow): BlobSyncRecord {
  return {
    hash: row.hash,
    // bigint arrives as a string over the wire protocol; sizes are well under
    // the safe-integer range (the browser could not hold such a file anyway).
    size: Number(row.size),
    mime: row.mime,
    syncState: row.sync_state === 'synced' ? 'synced' : 'local',
  };
}

export function createPgliteBlobSyncLocal(db: AppDb): IBlobSyncLocal {
  return {
    async pending(limit) {
      // Oldest first: a backlog drains in the order it was created, so the
      // file a user imported first is also the first to become durable.
      const { rows } = await db.query<BlobRow>(
        `select hash, size, mime, sync_state from blob
         where sync_state <> 'synced'
         order by created_at asc
         limit $1`,
        [limit]
      );
      return rows.map(toRecord);
    },

    async markSynced(hash) {
      await db.query(`update blob set sync_state = 'synced' where hash = $1`, [
        hash,
      ]);
    },

    async registerSynced(info: BlobInfo) {
      // A pulled blob may already be known locally (another node referenced it
      // first), so the insert yields to the existing row and only the state is
      // forced — the size/mime of the same hash cannot legitimately differ.
      await db.query(
        `insert into blob (hash, size, mime, sync_state)
         values ($1, $2, $3, 'synced')
         on conflict (hash) do update set sync_state = 'synced'`,
        [info.hash, info.size, info.mime]
      );
    },

    async find(hash) {
      const { rows } = await db.query<BlobRow>(
        `select hash, size, mime, sync_state from blob where hash = $1`,
        [hash]
      );
      return rows[0] ? toRecord(rows[0]) : null;
    },
  };
}
