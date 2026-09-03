import {
  type IDocumentRepository,
  LOCAL_USER_ID,
  type SerializedTree,
} from '@workspace/domain';
import type { SerializedEditorState } from 'lexical';
import { stateToMarkdown } from '../editing/markdown';
import { type ResolvedModels, runEditSession } from '../editing/run-edit';
import type { CodeRunner } from '../editing/runtime';
import type { EditOutcome } from '../worker/protocol';
import type { DocumentToolDeps } from './tools';

export interface EditDocumentDeps {
  documents: IDocumentRepository;
  models: () => ResolvedModels;
  runner?: CodeRunner;
  /**
   * The editor that has the document open, if any: what it holds now (the
   * session starts from what the user sees, not from the last save), and
   * where the result goes (into the editor, so the user keeps undo). Either
   * answers null/false when the document is not open.
   */
  openEditor?: {
    readState: (documentId: string) => Promise<SerializedEditorState | null>;
    applyEdit: (
      documentId: string,
      result: EditOutcome,
      partial: boolean
    ) => Promise<boolean>;
  };
}

/**
 * The `EditDocument` capability: load, run the editing session on a copy,
 * land the result — into the live editor if there is one, otherwise into
 * the store as an edit attributed to the assistant.
 */
export function createEditDocument(
  deps: EditDocumentDeps
): DocumentToolDeps['editDocument'] {
  return async ({ documentId, instructions, signal }) => {
    const loaded = await deps.documents.load(documentId);
    if (loaded.isErr()) return { summary: `Document ${documentId} not found.` };

    const live = await deps.openEditor?.readState(documentId);
    const state =
      live ??
      ((loaded.value.content?.tree ??
        emptyTree()) as unknown as SerializedEditorState);

    // With the document open, the edit shows as it happens — the local
    // counterpart of watching the assistant type through collaboration.
    const result = await runEditSession({
      state,
      prompt: instructions,
      models: deps.models(),
      runner: deps.runner,
      signal,
      onProgress: live
        ? (partial) =>
            void deps.openEditor?.applyEdit(documentId, partial, true)
        : undefined,
    });

    if (result.ops.length === 0) {
      return {
        summary: result.text || 'No changes were made.',
        clarification: result.clarification ?? null,
      };
    }

    const applied =
      (await deps.openEditor?.applyEdit(
        documentId,
        { ops: result.ops, state: result.state },
        false
      )) ?? false;
    if (!applied) {
      const markdown = stateToMarkdown(result.state);
      const saved = await deps.documents.save({
        id: documentId,
        tree: result.state as unknown as SerializedTree,
        markdown,
        preview: markdown.slice(0, 200),
        author: { user: LOCAL_USER_ID, src: 'ai' },
      });
      if (saved.isErr())
        return { summary: `Edit failed to save: ${saved.error}` };
    }

    return {
      summary: result.text || 'Applied edits.',
      clarification: result.clarification ?? null,
    };
  };
}

const emptyTree = () => ({
  root: {
    type: 'root',
    version: 1,
    format: '',
    indent: 0,
    direction: null,
    children: [
      {
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children: [],
      },
    ],
  },
});
