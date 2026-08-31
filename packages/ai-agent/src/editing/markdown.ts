import { $convertToMarkdownString } from '@lexical/markdown';
import {
  createEditingSession,
  loadMarkdown,
  loadSnapshot,
  toSnapshot,
} from '@workspace/ai-ops/ai-toolkit';
import { INTERNAL_TRANSFORMERS } from '@workspace/lexical-nodes/transformers';
import type { SerializedEditorState } from 'lexical';

/**
 * The markdown form of a serialized document, derived headlessly with the
 * same transformers the editor uses — so what the worker saves reads back
 * exactly as if the editor had serialized it.
 */
export function stateToMarkdown(state: SerializedEditorState): string {
  const session = createEditingSession();
  loadSnapshot(session, state);
  return session.editor
    .getEditorState()
    .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

/** The inverse: a document tree parsed from markdown, every node carrying an id. */
export function markdownToState(markdown: string): SerializedEditorState {
  const session = createEditingSession();
  loadMarkdown(session, markdown);
  return toSnapshot(session);
}
