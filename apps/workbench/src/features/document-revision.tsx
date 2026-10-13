/**
 * @file When the open document changed underneath the editor.
 *
 * The editor owns the document once it has mounted — that is deliberate, and
 * it is why `DocumentView` ignores later changes to `initialMarkdown`: reading
 * the document again under the user's cursor would drop their edits. Restoring
 * a version is the one case that must override that, because the stored
 * document genuinely became something else and the surface showing the old one
 * is now wrong.
 *
 * So the surface is remounted rather than patched: one counter, bumped by
 * whoever rewrote the document, read by the pane as part of the editor's key.
 * The alternative — pushing a tree into the live editor — is the agent's path
 * and needs the agent's bridge, which a page without an assistant does not
 * have.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

export interface DocumentRevision {
  /** Bumped every time the open document was rewritten outside the editor. */
  revision: number;
  /** Say that the stored document changed and the editor must read it again. */
  reload: () => void;
}

const Ctx = createContext<DocumentRevision | null>(null);

export function DocumentRevisionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  const value = useMemo<DocumentRevision>(
    () => ({ revision, reload }),
    [revision, reload]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The revision the pane should show. Outside a provider the document is only
 * ever read once — which is what a surface with no restore affordance wants,
 * so this does not throw.
 */
export function useDocumentRevision(): DocumentRevision {
  return useContext(Ctx) ?? NO_RELOADS;
}

const NO_RELOADS: DocumentRevision = { revision: 0, reload: () => {} };
