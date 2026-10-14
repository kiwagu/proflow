/**
 * @file Which documents an editor holds open right now, and what they hold.
 *
 * The document port lags the editor: a keystroke waits out a debounce, then
 * an asynchronous write, then possibly a retry, and the port's cache learns
 * the new content only when that write lands. Anything that must answer for
 * the document AS THE USER SEES IT — an export, a copy — therefore asks the
 * editor, not the port, and falls back to the port only for a document no
 * editor holds.
 *
 * The editor pane and the surfaces that act on documents (explorer menu,
 * palette) are siblings, so the registry sits above both of them, like the
 * revision counter does. A reader is a function: it is called at the moment
 * of asking and serialises the live state then, so nothing here goes stale.
 */
import type { SerializedTree } from '@workspace/domain';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface LiveDocuments {
  /**
   * Announces the tree an editor holds for `documentId`. Returns the release
   * that forgets it again — a release from an older registration of the same
   * document leaves a newer one alone, because a remount registers the new
   * editor before the old one's cleanup runs.
   *
   * One editor per document is the contract: the workbench opens a document
   * in one surface at a time, and the LAST registration owns the id. Two
   * editors on the same document would need a stack here, not a slot.
   */
  register(documentId: string, read: () => SerializedTree): () => void;
  /** The tree the open editor holds this instant; null when none holds it. */
  read(documentId: string): SerializedTree | null;
}

export function createLiveDocuments(): LiveDocuments {
  const readers = new Map<string, () => SerializedTree>();
  return {
    register(documentId, read) {
      readers.set(documentId, read);
      return () => {
        if (readers.get(documentId) === read) readers.delete(documentId);
      };
    },
    read(documentId) {
      return readers.get(documentId)?.() ?? null;
    },
  };
}

const Ctx = createContext<LiveDocuments | null>(null);

export function LiveDocumentsProvider({
  value,
  children,
}: {
  /** A registry built elsewhere; the provider makes its own when absent. */
  value?: LiveDocuments;
  children: ReactNode;
}) {
  const live = useMemo(() => value ?? createLiveDocuments(), [value]);
  return <Ctx.Provider value={live}>{children}</Ctx.Provider>;
}

/**
 * The registry, or a silent one outside a provider: a surface mounted alone
 * (a spec, a prototype) has no sibling asking about its document, so there is
 * nothing to register with and nothing to throw about.
 */
export function useLiveDocuments(): LiveDocuments {
  return useContext(Ctx) ?? NONE;
}

const NONE: LiveDocuments = {
  register: () => () => {},
  read: () => null,
};
