/**
 * @file The headless markdown round trip.
 *
 * Markdown in, serialized editor state out — with ids already assigned. Used
 * by every non-browser producer of document content: import, seed, and the
 * agent.
 *
 * The id pass runs before the state is returned, deliberately. A tree without
 * ids is rejected by the sync layer, and the failure would surface far from
 * here (at commit time, in a different package) with nothing pointing back at
 * the import that produced it.
 */
import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $getRoot,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { SupportedNodeTypes } from '../node-list';
import {
  createNodeIdMappings,
  type NodeIdMappings,
  $updateAllNodeIds,
} from '../plugins/nodeIdPlugin';
import { INTERNAL_TRANSFORMERS } from '../transformers';

export type MarkdownStateResult = {
  state: SerializedEditorState;
  ids: NodeIdMappings;
};

function headlessEditor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

/**
 * Markdown to serialized editor state, every node carrying a durable id.
 */
export function markdownToState(
  markdown: string,
  transformers: Transformer[] = INTERNAL_TRANSFORMERS
): MarkdownStateResult {
  const editor = headlessEditor();
  const ids = createNodeIdMappings();

  editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, transformers);
    },
    { discrete: true }
  );

  editor.update(
    () => {
      $updateAllNodeIds(ids);
    },
    { discrete: true }
  );

  return { state: editor.getEditorState().toJSON(), ids };
}

/** Serialized editor state back to markdown. */
export function stateToMarkdown(
  state: SerializedEditorState,
  transformers: Transformer[] = INTERNAL_TRANSFORMERS
): string {
  const editor = headlessEditor();
  editor.setEditorState(editor.parseEditorState(state));
  let markdown = '';
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString(transformers);
  });
  return markdown;
}
