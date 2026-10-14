import type { FileNode } from '@workspace/domain';
import { allowed } from '@workspace/knowledge-contracts';
import { useEffect, useState } from 'react';
import { useServices, useWriteScope } from '../composition/app-services';

/**
 * Whether the person may write the body of a document, as the write scope
 * says for the node the document belongs to.
 *
 * The tree is consulted only when the answer depends on whose node it is
 * (an "own" verdict); "all" and "none" need no row. While the owner is not
 * known yet the answer stays yes: a document the person just created must
 * not show up read-only for a moment, and the server remains the fence for
 * the instant it takes to learn the owner.
 */
export function useMayWriteDocument(documentId: string): boolean {
  const services = useServices();
  const scope = useWriteScope();
  const verdict = scope?.['body.write'];
  const needsOwner = typeof verdict === 'object' && verdict !== null;
  const [owner, setOwner] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!needsOwner || !services.fileTree) return;
    return services.fileTree.watchAll((nodes: FileNode[]) => {
      const node = nodes.find((n) => n.documentId === documentId);
      setOwner(node ? node.ownerUserId : null);
    });
  }, [needsOwner, services.fileTree, documentId]);

  if (!needsOwner)
    return allowed(scope, 'body.write', {}, services.identity.userId);
  if (owner === undefined) return true;
  return allowed(
    scope,
    'body.write',
    { owner_user_id: owner },
    services.identity.userId
  );
}
