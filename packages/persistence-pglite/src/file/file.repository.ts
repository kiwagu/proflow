import {
  type IBlobStore,
  type IFileRepository,
  type IPackageStore,
  newId,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import {
  FILE_NODE_LIVE,
  FILE_NODE_SELECT,
  type FileNodeRow,
  toFileNode,
} from './file.mapper.js';

/**
 * File tree commands. Bytes go to the blob store first and the node row is
 * written only once they are durable, so a node never points at bytes that
 * are not there.
 */
export function createPgliteFileRepository(
  db: AppDb,
  blobs: IBlobStore,
  packages?: IPackageStore
): IFileRepository {
  async function read(id: string) {
    const { rows } = await db.query<FileNodeRow>(
      `select ${FILE_NODE_SELECT} where f.id = $1`,
      [id]
    );
    return rows[0] ? toFileNode(rows[0]) : null;
  }

  const repo: IFileRepository = {
    async createFolder({ parentId, name, id = newId('fileNode') }) {
      try {
        await db.query(
          `insert into file_node (id, parent_id, kind, name) values ($1, $2, 'folder', $3)`,
          [id, parentId, name]
        );
        const node = await read(id);
        return node ? ok(node) : err('folder insert returned no row');
      } catch (e) {
        return err(`file.createFolder failed: ${String(e)}`);
      }
    },

    async importFile({
      parentId,
      name,
      blob,
      onProgress,
      id = newId('fileNode'),
    }) {
      try {
        const info = await blobs.put(blob, onProgress);
        await db.transaction(async (tx) => {
          await tx.query(
            `insert into blob (hash, size, mime) values ($1, $2, $3)
             on conflict (hash) do nothing`,
            [info.hash, info.size, info.mime]
          );
          await tx.query(
            `insert into file_node (id, parent_id, kind, name, mime, size, blob_hash)
             values ($1, $2, 'blob', $3, $4, $5, $6)`,
            [id, parentId, name, info.mime, info.size, info.hash]
          );
        });
        const node = await read(id);
        return node ? ok(node) : err('file insert returned no row');
      } catch (e) {
        return err(`file.importFile failed: ${String(e)}`);
      }
    },

    async get(id) {
      try {
        const node = await read(id);
        return node ? ok(node) : err(`file ${id} not found`);
      } catch (e) {
        return err(`file.get failed: ${String(e)}`);
      }
    },

    async findByBlob(hash) {
      try {
        const { rows } = await db.query<FileNodeRow>(
          `select ${FILE_NODE_SELECT} where f.blob_hash = $1 and ${FILE_NODE_LIVE}
           order by f.created_at limit 1`,
          [hash]
        );
        return ok(rows[0] ? toFileNode(rows[0]) : null);
      } catch (e) {
        return err(`file.findByBlob failed: ${String(e)}`);
      }
    },

    async rename(id, name) {
      try {
        // A native document's name IS its title.
        await db.query(
          `update document set title = $2, updated_at = now()
           where id = (select document_id from file_node where id = $1)`,
          [id, name]
        );
        await db.query(
          'update file_node set name = $2, updated_at = now() where id = $1',
          [id, name]
        );
        return ok(undefined);
      } catch (e) {
        return err(`file.rename failed: ${String(e)}`);
      }
    },

    async move(id, parentId) {
      try {
        if (parentId !== null) {
          // Refuse to move a folder under itself or any of its descendants.
          const { rows } = await db.query<{ cyclic: boolean }>(
            `with recursive up as (
               select id, parent_id from file_node where id = $2
               union all
               select f.id, f.parent_id from file_node f join up on f.id = up.parent_id
             )
             select exists (select 1 from up where id = $1) as cyclic`,
            [id, parentId]
          );
          if (rows[0]?.cyclic) return err('cannot move a folder into itself');
        }
        await db.query(
          'update file_node set parent_id = $2, updated_at = now() where id = $1',
          [id, parentId]
        );
        return ok(undefined);
      } catch (e) {
        return err(`file.move failed: ${String(e)}`);
      }
    },

    async setStarred(id, starred) {
      try {
        await db.query(
          'update file_node set starred = $2, updated_at = now() where id = $1',
          [id, starred]
        );
        await db.query(
          `update document set starred = $2
           where id = (select document_id from file_node where id = $1)`,
          [id, starred]
        );
        return ok(undefined);
      } catch (e) {
        return err(`file.setStarred failed: ${String(e)}`);
      }
    },

    async collectGarbage() {
      try {
        // Deleted nodes go for good first: a node still holding a hash
        // would keep its bytes alive, and its subtree went with it.
        await db.query('delete from file_node where deleted_at is not null');
        // Then the bytes no live node and no live document names. A
        // document references attachments by hash in its markdown, which
        // is the derived form every reader already agrees on.
        const { rows } = await db.query<{ hash: string }>(
          `delete from blob b
           where not exists (
             select 1 from file_node f
             where f.blob_hash = b.hash and f.deleted_at is null
           )
           and not exists (
             select 1 from document_content dc
             join document d on d.id = dc.document_id
             where d.deleted_at is null and position(b.hash in dc.markdown) > 0
           )
           returning b.hash`
        );
        // Package rows went with the blob row (cascade); the unpacked
        // files and the bytes themselves live outside the database.
        await Promise.all(
          rows.flatMap(({ hash }) => [
            blobs.delete(hash),
            packages?.remove(hash) ?? Promise.resolve(),
          ])
        );
        return ok(rows.map((r) => r.hash));
      } catch (e) {
        return err(`file.collectGarbage failed: ${String(e)}`);
      }
    },

    async softDelete(id) {
      try {
        // Deleting a folder takes its subtree with it; deleting a document
        // node deletes the document it stands for.
        await db.query(
          `with recursive sub as (
             select id from file_node where id = $1
             union all
             select f.id from file_node f join sub on f.parent_id = sub.id
           )
           update file_node set deleted_at = now()
           where id in (select id from sub) and deleted_at is null`,
          [id]
        );
        await db.query(
          `update document set deleted_at = now()
           where deleted_at is null and id in (
             select document_id from file_node
             where deleted_at is not null and document_id is not null
           )`
        );
        // Deleting a file the user can see must free what it held: with
        // content addressing the bytes outlive the node, and an archive
        // whose unpacked copy survived would come back already unpacked.
        await repo.collectGarbage();
        return ok(undefined);
      } catch (e) {
        return err(`file.softDelete failed: ${String(e)}`);
      }
    },
  };
  return repo;
}
