import type { IFileTreeReader } from '@workspace/domain';
import type { AppDb } from '../db/db.js';
import { watchQuery } from '../live/watch.js';
import {
  FILE_NODE_LIVE,
  FILE_NODE_SELECT,
  type FileNodeRow,
  toFileNode,
} from './file.mapper.js';

export function createPgliteFileTreeReader(db: AppDb): IFileTreeReader {
  return {
    watchAll(cb) {
      return watchQuery<FileNodeRow>(
        db,
        `select ${FILE_NODE_SELECT}
         where ${FILE_NODE_LIVE}
         order by f.kind = 'folder' desc, lower(coalesce(d.title, f.name)), f.created_at`,
        [],
        (rows) => cb(rows.map(toFileNode))
      );
    },
  };
}
