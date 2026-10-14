import type { DocumentId } from '@workspace/entity-id';

/**
 * The server has no row for this document, and this device may not create
 * one: the owner of the body is not known here. Registering a document fixes
 * who owns its body for good, and the server accepts it only from someone
 * who could edit the resource it names, so a device that cannot name that
 * resource waits for the document to be registered by its creator instead
 * of registering it unowned.
 */
export class DocumentNotRegisteredError extends Error {
  constructor(readonly documentId: DocumentId) {
    super(`document ${documentId} is not registered on the server`);
    this.name = 'DocumentNotRegisteredError';
  }
}
