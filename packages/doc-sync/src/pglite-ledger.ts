import type { SyncJournal, SyncLedger } from './types.js';

/**
 * The subset of a PGlite client (or worker proxy) the ledger needs —
 * matches `AppDb` from the persistence package without depending on it.
 */
export interface LedgerDb {
  query: <T = unknown>(
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: T[] }>;
}

/**
 * How far below the space cursor each pass re-reads. Two heads stamped in
 * the same instant, one after the cursor was taken, would otherwise be
 * invisible forever; re-reading a window costs a few ledger reads.
 */
export const HEADS_OVERLAP_MS = 5_000;

/**
 * The per-document sync ledger over the local `document_sync` table, and
 * the space feed cursor over `document_sync_space`.
 */
export function createPgliteLedger(db: LedgerDb): SyncLedger {
  return {
    async read(documentId) {
      const { rows } = await db.query<{
        pushed_vv: Uint8Array | null;
        pulled_seq: number | string;
      }>(
        'select pushed_vv, pulled_seq from document_sync where document_id = $1',
        [documentId]
      );
      return {
        pushedVv: rows[0]?.pushed_vv ?? null,
        pulledSeq: Number(rows[0]?.pulled_seq ?? 0),
      };
    },

    async recordPush(documentId, pushedVv) {
      await db.query(
        `insert into document_sync (document_id, pushed_vv)
         values ($1, $2)
         on conflict (document_id) do update
           set pushed_vv = excluded.pushed_vv, updated_at = now()`,
        [documentId, pushedVv]
      );
    },

    async recordPull(documentId, pulledSeq) {
      // greatest(): the watermark only ever advances. A slow writer landing
      // after a faster one must not move it back — bytes past the watermark
      // are never re-requested, so a regression would create a re-fetch of
      // rows already imported (harmless) but also mask a real gap (not).
      await db.query(
        `insert into document_sync (document_id, pulled_seq)
         values ($1, $2)
         on conflict (document_id) do update
           set pulled_seq = greatest(document_sync.pulled_seq, excluded.pulled_seq),
               updated_at = now()`,
        [documentId, pulledSeq]
      );
    },

    async headsCursor(spaceId) {
      const { rows } = await db.query<{ heads_cursor: string | Date | null }>(
        'select heads_cursor from document_sync_space where space_id = $1',
        [spaceId]
      );
      const raw = rows[0]?.heads_cursor ?? null;
      if (raw === null) return null;
      return new Date(new Date(raw).getTime() - HEADS_OVERLAP_MS);
    },

    async advanceHeadsCursor(spaceId, cursor) {
      await db.query(
        `insert into document_sync_space (space_id, heads_cursor)
         values ($1, $2)
         on conflict (space_id) do update
           set heads_cursor = greatest(document_sync_space.heads_cursor, excluded.heads_cursor),
               updated_at = now()`,
        [spaceId, cursor]
      );
    },
  };
}

/**
 * Makes pulled blobs locally durable by appending them to the local update
 * journal — the same table local writers append to, so the restore path
 * (snapshot + journal replay) picks pulled operations up with no extra code,
 * and the next local snapshot folds them in and trims the rows.
 */
export function createPgliteJournal(db: LedgerDb): SyncJournal {
  return {
    async append(documentId, blobs) {
      for (const bytes of blobs) {
        await db.query(
          'insert into document_update (document_id, bytes) values ($1, $2)',
          [documentId, bytes]
        );
      }
    },
  };
}
