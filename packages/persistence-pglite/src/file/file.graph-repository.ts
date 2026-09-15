import {
  type IBlobStore,
  type IFileRepository,
  type IPackageStore,
  newId,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import { createPgliteGraphRepository } from '../graph/graph.repository.js';
import { graphInTransaction } from '../graph/graph.transaction.js';
import {
  GRAPH_FILE_SELECT,
  GRAPH_FILE_LIVE,
  type GraphFileRow,
  toGraphFileNode,
} from './file.graph-reader.js';

export function createGraphFileRepository(
  db: AppDb,
  blobs: IBlobStore,
  spaceId: string,
  userId: string,
  packages?: IPackageStore
): IFileRepository {
  const graph = createPgliteGraphRepository(db);
  const read = async (predicate: string, value: string) => {
    const { rows } = await db.query<GraphFileRow>(
      `select ${GRAPH_FILE_SELECT} where ${GRAPH_FILE_LIVE} and ${predicate} order by r.created_at limit 1`,
      [spaceId, userId, value]
    );
    return rows[0] ? toGraphFileNode(rows[0]) : null;
  };
  const repo: IFileRepository = {
    async createFolder({ name, parentId, id = newId('knowledgeResource') }) {
      try {
        const result = await graph.createNode({
          id,
          title: name,
          parentId,
          spaceId,
          createdBy: userId,
          kind: 'folder',
        });
        if (result.isErr()) return err(result.error);
        return repo.get(id);
      } catch (e) {
        return err(`file.createFolder failed: ${String(e)}`);
      }
    },
    async get(id) {
      try {
        const node = await read('r.id = $3', id);
        return node ? ok(node) : err(`file ${id} not found`);
      } catch (e) {
        return err(`file.get failed: ${String(e)}`);
      }
    },
    async findByBlob(hash) {
      try {
        return ok(await read('f.blob_hash = $3', hash));
      } catch (e) {
        return err(`file.findByBlob failed: ${String(e)}`);
      }
    },
    async importFile({
      name,
      parentId,
      blob,
      onProgress,
      id = newId('knowledgeResource'),
    }) {
      try {
        // Bytes first; all SQL rows and the journal then commit together.
        const info = await blobs.put(blob, onProgress);
        await db.transaction(async (tx) => {
          await tx.query(
            'insert into blob (hash, size, mime) values ($1, $2, $3) on conflict (hash) do nothing',
            [info.hash, info.size, info.mime]
          );
          // Containment belongs to the graph, not to the blob metadata row.
          await tx.query(
            "insert into file_node (id, kind, name, mime, size, blob_hash) values ($1, 'blob', $2, $3, $4, $5)",
            [id, name, info.mime, info.size, info.hash]
          );
          const result = await graphInTransaction(tx).createNode({
            id,
            title: name,
            parentId,
            spaceId,
            createdBy: userId,
            kind: 'file',
          });
          if (result.isErr()) throw new Error(result.error);
        });
        return repo.get(id);
      } catch (e) {
        return err(`file.importFile failed: ${String(e)}`);
      }
    },
    async rename(id, name) {
      try {
        await db.transaction(async (tx) => {
          const result = await graphInTransaction(tx).renameNode(id, name);
          if (result.isErr()) throw new Error(result.error);
          await tx.query(
            `update document set title = $2, updated_at = now()
            where id = (select body_ref ->> 'doc_id' from knowledge_resources where id = $1 and kind = 'text')`,
            [id, name]
          );
        });
        return ok(undefined);
      } catch (e) {
        return err(`file.rename failed: ${String(e)}`);
      }
    },
    async move(id, parentId) {
      try {
        await db.transaction(async (tx) => {
          if (parentId !== null) {
            // UNION deduplicates ancestors even if a pulled graph is already cyclic.
            const { rows } = await tx.query<{ cyclic: boolean }>(
              `with recursive up(id) as (
              select $2::text union
              select e.from_id from knowledge_edges e join up on e.to_id = up.id
              where e.relation_type = 'contains' and e.space_id = $3
            ) select exists(select 1 from up where id = $1) as cyclic`,
              [id, parentId, spaceId]
            );
            if (rows[0]?.cyclic)
              throw new Error('cannot move a folder into itself');
          }
          const result = await graphInTransaction(tx).moveNode(
            { spaceId, nodeId: id, targetParentId: parentId, position: 0 },
            userId
          );
          if (result.isErr()) throw new Error(result.error);
        });
        return ok(undefined);
      } catch (e) {
        return err(`file.move failed: ${String(e)}`);
      }
    },
    setStarred: (id, starred) => graph.setStarred(spaceId, id, userId, starred),
    async softDelete(id) {
      try {
        await db.transaction(async (tx) => {
          const result = await graphInTransaction(tx).trashNode(id, userId);
          if (result.isErr()) throw new Error(result.error);
          // Mirror the server's contains cascade while offline. Only the root
          // is journaled; its timestamp also belongs to the local descendants.
          await tx.query(
            `with recursive sub(id) as (
              select id from knowledge_resources where id = $1 and space_id = $2
              union
              select e.to_id from knowledge_edges e join sub on e.from_id = sub.id
              where e.relation_type = 'contains' and e.space_id = $2
            )
            update knowledge_resources r
            set deleted_at = root.deleted_at, trashed_by = root.trashed_by, updated_at = root.updated_at
            from knowledge_resources root
            where root.id = $1 and r.space_id = $2 and r.id in (select id from sub)
              and r.deleted_at is null`,
            [id, spaceId]
          );
        });
        return ok(undefined);
      } catch (e) {
        return err(`file.softDelete failed: ${String(e)}`);
      }
    },
    async collectGarbage() {
      try {
        // The graph owns liveness; blob metadata also outlives purged nodes.
        await db.query(`delete from file_node f where not exists (
          select 1 from knowledge_resources r where r.id = f.id
        )`);
        const { rows } = await db.query<{ hash: string }>(`delete from blob b
          where not exists (select 1 from file_node f join knowledge_resources r on r.id = f.id
            where f.blob_hash = b.hash)
          and not exists (select 1 from document_content dc join document d on d.id = dc.document_id
            join knowledge_resources r on r.body_ref ->> 'doc_id' = d.id and r.kind = 'text'
            where position(b.hash in dc.markdown) > 0)
          returning b.hash`);
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
  };
  return repo;
}
