/**
 * @file Which editor is on screen for a document, for the surfaces that
 * draw over it from outside.
 *
 * The outline lives in the aside, a sibling of the editor pane, so it cannot
 * read the editor's own context; it needs the live instance handed across.
 * This is the push-based counterpart of the live-documents registry: that
 * one answers "what does the document say" through a reader called at the
 * moment of asking, with nothing to re-render; this one answers "which
 * editor is open", and a panel drawing over the editor has to re-render the
 * moment it mounts, remounts under another document, or goes away.
 */
import type { LexicalWrapper } from '@workspace/lexical-react';
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export interface LiveEditor {
  documentId: string;
  wrapper: LexicalWrapper;
}

export interface LiveEditors {
  /**
   * Announces the editor mounted for a document. Returns the release that
   * forgets it again — a release from an older registration of the same
   * document leaves a newer one alone, because a remount registers the new
   * editor before the old one's cleanup runs.
   */
  register(live: LiveEditor): () => void;
  /** The editor open for `documentId` this instant; null when none is. */
  get(documentId: string): LiveEditor | null;
  /** Told after every registration and release. */
  subscribe(listener: () => void): () => void;
}

export function createLiveEditors(): LiveEditors {
  const editors = new Map<string, LiveEditor>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    register(live) {
      editors.set(live.documentId, live);
      notify();
      return () => {
        if (editors.get(live.documentId) !== live) return;
        editors.delete(live.documentId);
        notify();
      };
    },
    get(documentId) {
      return editors.get(documentId) ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const Ctx = createContext<LiveEditors | null>(null);

export function LiveEditorsProvider({
  value,
  children,
}: {
  /** A registry built elsewhere; the provider makes its own when absent. */
  value?: LiveEditors;
  children: ReactNode;
}) {
  const live = useMemo(() => value ?? createLiveEditors(), [value]);
  return <Ctx.Provider value={live}>{children}</Ctx.Provider>;
}

/**
 * The registry, or a silent one outside a provider: an editor mounted alone
 * (a spec, a prototype) has nothing drawing over it, so there is nothing to
 * announce to and nothing to throw about.
 */
export function useLiveEditors(): LiveEditors {
  return useContext(Ctx) ?? NONE;
}

/** The editor open for a document, re-rendering as it mounts and unmounts. */
export function useLiveEditor(documentId: string | null): LiveEditor | null {
  const live = useLiveEditors();
  return useSyncExternalStore(live.subscribe, () =>
    documentId ? live.get(documentId) : null
  );
}

const NONE: LiveEditors = {
  register: () => () => {},
  get: () => null,
  subscribe: () => () => {},
};
