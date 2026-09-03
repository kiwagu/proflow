import type { Frontiers } from '@workspace/doc-crdt';
import {
  type DocumentVersion,
  type EditRecord,
  type IDocumentVersionStore,
  newId,
} from '@workspace/domain';
import { err, ok } from 'neverthrow';
import type { AppDb } from '../db/db.js';
import type { DocumentCrdtStore } from './document.crdt-store.js';

type VersionRow = {
  id: string;
  document_id: string;
  label: string | null;
  kind: DocumentVersion['kind'];
  frontiers: Frontiers;
  created_at: string;
};

const toVersion = (row: VersionRow): DocumentVersion => ({
  id: row.id,
  documentId: row.document_id,
  label: row.label,
  kind: row.kind,
  ref: row.frontiers,
  createdAt: new Date(row.created_at),
});

/**
 * Versions of a document.
 *
 * A version is stored as a frontier — a position in the document's history,
 * tens of bytes — rather than a copy of the document. That is what makes
 * marking one cheap enough to do on every idle pause.
 */
export function createPgliteDocumentVersionStore(
  db: AppDb,
  crdt: DocumentCrdtStore
): IDocumentVersionStore {
  return {
    async mark({ documentId, label, kind }) {
      try {
        const frontiers = await crdt.frontiers(documentId);
        const { rows } = await db.query<VersionRow>(
          `insert into document_version (id, document_id, label, kind, frontiers)
           values ($1, $2, $3, $4, $5)
           returning id, document_id, label, kind, frontiers, created_at`,
          [
            newId('documentVersion'),
            documentId,
            label ?? null,
            kind,
            JSON.stringify(frontiers),
          ]
        );
        const row = rows[0];
        if (!row) return err('insert returned no row');
        return ok(toVersion(row));
      } catch (e) {
        return err(`version.mark failed: ${String(e)}`);
      }
    },

    async listEdits(documentId) {
      try {
        const changes = await crdt.changes(documentId);
        const records: EditRecord[] = changes.map((c) => ({
          at: new Date(c.at),
          author: c.author,
          length: c.length,
        }));
        return ok(records);
      } catch (e) {
        return err(`version.listEdits failed: ${String(e)}`);
      }
    },

    async list(documentId) {
      try {
        const { rows } = await db.query<VersionRow>(
          `select id, document_id, label, kind, frontiers, created_at
             from document_version
            where document_id = $1
            order by created_at desc, id desc`,
          [documentId]
        );
        return ok(rows.map(toVersion));
      } catch (e) {
        return err(`version.list failed: ${String(e)}`);
      }
    },

    async readAt(documentId, ref) {
      try {
        return ok(await crdt.readAt(documentId, ref as Frontiers));
      } catch (e) {
        return err(`version.readAt failed: ${String(e)}`);
      }
    },

    async restore({ documentId, ref, author }) {
      try {
        await crdt.restore(documentId, ref as Frontiers, author);
        return ok(undefined);
      } catch (e) {
        return err(`version.restore failed: ${String(e)}`);
      }
    },
  };
}
