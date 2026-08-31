import type { IPackageReader } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';

export function createPglitePackageReader(db: AppDb): IPackageReader {
  return {
    watchUnpacked(cb) {
      return watchQuery<{ hash: string }>(
        db,
        'select hash from package',
        [],
        (rows) => cb(rows.map((row) => row.hash))
      );
    },
  };
}
