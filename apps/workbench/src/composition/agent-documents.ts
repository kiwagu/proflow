import type { IDocumentRepository } from '@workspace/domain';
import {
  allowed,
  type WriteAction,
  type WriteScope,
} from '@workspace/knowledge-contracts';
import { err, type Result } from 'neverthrow';

/**
 * The documents the assistant reaches, behind the same write scope as the
 * person's own edits. The assistant runs in a worker and writes through
 * these ports; a document the person may only read is not saved, renamed or
 * trashed on its say-so, and nothing is created where the person may not
 * create. The scope is asked at the moment of each write, so a right
 * revoked while a long edit runs refuses its result. The server stays the
 * fence; this keeps the assistant from changing the local copy where the
 * server would refuse the change.
 */
export function guardDocumentWrites(
  documents: IDocumentRepository,
  rights: {
    scope: () => WriteScope | null;
    userId: string;
    /** Who owns the node a document belongs to (null when nobody or unknown). */
    ownerOfDocument: (documentId: string) => Promise<string | null>;
  }
): IDocumentRepository {
  const may = async (action: WriteAction, documentId: string) =>
    allowed(
      rights.scope(),
      action,
      { owner_user_id: await rights.ownerOfDocument(documentId) },
      rights.userId
    );
  const refused = <T>(): Result<T, string> =>
    err('You may not change this document.');

  return {
    ...documents,
    async create(input) {
      if (!allowed(rights.scope(), 'node.create', {}, rights.userId))
        return err('You may not create documents here.');
      return documents.create(input);
    },
    async save(input) {
      if (!(await may('body.write', input.id))) return refused();
      return documents.save(input);
    },
    async rename(id, title) {
      if (!(await may('node.update', id))) return refused();
      return documents.rename(id, title);
    },
    async softDelete(id) {
      if (!(await may('node.trash', id))) return refused();
      return documents.softDelete(id);
    },
  };
}
