/**
 * @file The seam between the agent worker and whatever editor the page has open.
 *
 * An editing session runs in the worker on a headless copy of the document
 * and hands back a whole tree. Two questions cross back to the page for it:
 * "what does the editor currently hold?" before the session, and "take this
 * result" during and after it. Answering them is the editor's job, not the
 * agent's — so this module defines only the shape of an answer, and the
 * editor-side implementation lands beside the live editor instance.
 *
 * Until an editor registers itself, the worker gets `null`/`false` and falls
 * back to the document store: an AI edit still runs and still lands, it just
 * lands through storage rather than in the user's undo stack.
 */
import type { EditOutcome, OpenDocumentHooks } from '@workspace/ai-agent';
import type { SerializedEditorState } from 'lexical';

/**
 * One live editor, as the agent addresses it.
 *
 * Both methods are asked about a specific document because the page can
 * have moved on: the session that started against the open document may
 * finish after the user opened another one, and answering for the wrong
 * document would overwrite it. An implementation that does not hold
 * `documentId` answers `null` / `false`.
 */
export interface EditorDocumentBridge {
  /** Which document this editor holds, or `null` when it holds none. */
  documentId: () => string | null;
  /** The editor's current content, or `null` when it holds another document. */
  readState: (documentId: string) => SerializedEditorState | null;
  /**
   * Land an edit in the live editor. `partial` marks a result the session
   * will still add to, so an implementation can keep the whole session in
   * one undo step. Returns whether it was applied — `false` sends the agent
   * back to the document store.
   */
  applyEdit: (
    documentId: string,
    result: EditOutcome,
    partial: boolean
  ) => boolean;
}

/**
 * The page's hook table for the worker client, over whichever bridge is
 * registered at the moment a question arrives.
 *
 * The indirection is the point: the client takes one registration for the
 * lifetime of the page, while editors mount and unmount under it. Reading
 * the bridge per call, rather than capturing it, means an editor that
 * unmounted mid-session cannot receive the result of that session.
 */
export function openDocumentHooks(
  current: () => EditorDocumentBridge | undefined
): OpenDocumentHooks {
  return {
    readState: (documentId) => current()?.readState(documentId) ?? null,
    applyEdit: (documentId, result, partial) =>
      current()?.applyEdit(documentId, result, partial) ?? false,
  };
}

/**
 * A registry of at most one bridge, with last-registration-wins semantics
 * and a disposer that only clears its own registration.
 *
 * The page has one editor pane, so a second registration replaces the first
 * rather than stacking. Unmount order is not guaranteed to be the reverse
 * of mount order under a route change, though: a disposer that cleared
 * unconditionally would tear down the bridge of the editor that just
 * replaced it.
 */
export function createEditorBridgeRegistry(): {
  register: (bridge: EditorDocumentBridge) => () => void;
  current: () => EditorDocumentBridge | undefined;
} {
  let bridge: EditorDocumentBridge | undefined;
  return {
    register(next) {
      bridge = next;
      return () => {
        if (bridge === next) bridge = undefined;
      };
    },
    current: () => bridge,
  };
}
