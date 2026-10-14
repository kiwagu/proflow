/**
 * @file What the document store says changed, for the surface showing a document.
 *
 * A save made here, a restore, and a merge pulled from another device all
 * leave the stored document saying something new. The editor pane needs
 * the last kind: it owns its content once mounted, so a merge has to be
 * handed to it rather than read back from storage. The composition root
 * builds the feed from the store; the provider carries it to the pane the
 * same way the live registries travel.
 */
import type { SerializedTree } from '@workspace/domain';
import { createContext, useContext, type ReactNode } from 'react';

export interface DocumentChange {
  id: string;
  /** `local`: this page saved or restored. `remote`: a pull merged in. */
  source: 'local' | 'remote';
  tree: SerializedTree;
  markdown: string;
}

export interface DocumentChanges {
  onChanged(listener: (event: DocumentChange) => void): () => void;
  /**
   * A document that was waiting for its first pull heard from the server:
   * whatever it held is merged in, or nothing was there. A pull that finds
   * nothing merges nothing, so no change arrives for it — this is how the
   * surface that showed the wait learns the wait is over.
   */
  onSettled(listener: (documentId: string) => void): () => void;
}

const Ctx = createContext<DocumentChanges | null>(null);

export function DocumentChangesProvider({
  value,
  children,
}: {
  value: DocumentChanges;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The feed, or a silent one outside a provider: an editor mounted alone (a
 * spec, a prototype) replicates nothing, so nothing will ever arrive.
 */
export function useDocumentChanges(): DocumentChanges {
  return useContext(Ctx) ?? NONE;
}

const NONE: DocumentChanges = {
  onChanged: () => () => {},
  onSettled: () => () => {},
};
