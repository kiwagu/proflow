import type { Unsubscribe } from '@workspace/domain';
import type { AppDb } from '../db/db.js';

/**
 * Wraps a `live.query` into the domain's watch shape: deliver rows now and on
 * every change until unsubscribed. The async setup is hidden — callers get a
 * synchronous unsubscribe, safe to call before the query is even attached.
 */
export function watchQuery<Row>(
  db: AppDb,
  sql: string,
  params: unknown[],
  cb: (rows: Row[]) => void
): Unsubscribe {
  let closed = false;
  let detach: (() => Promise<void> | void) | undefined;

  db.live
    .query<Row>(sql, params, (res) => {
      if (!closed) cb(res.rows);
    })
    .then((handle) => {
      if (closed) {
        void handle.unsubscribe();
        return;
      }
      detach = () => handle.unsubscribe();
      // Initial delivery. The change callback may also fire immediately
      // depending on the live extension's timing; a duplicate delivery of
      // identical rows is harmless.
      cb(handle.initialResults.rows);
    })
    .catch((e) => {
      console.error('watchQuery failed', e);
    });

  return () => {
    closed = true;
    void detach?.();
  };
}
