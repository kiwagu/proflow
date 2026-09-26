/**
 * @file Markdown in and out of the document port, headlessly.
 *
 * Import produces the TREE the editor mounts: a document is its tree, and
 * the markdown beside it is derived from that tree the way every save
 * derives it, so what the editor opens is exactly what a save would have
 * written. The import reads both markdown forms — the lossless internal tags
 * and the portable links — because a file may come from either side.
 *
 * Export renders the tree in the portable form only: an own node degrades to
 * what any reader understands, and the internal tags never leave the product.
 */
import type {
  EditAuthor,
  IDocumentRepository,
  SerializedTree,
} from '@workspace/domain';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
} from '@workspace/lexical-nodes/transformers';
import {
  markdownToState,
  stateToMarkdown,
} from '@workspace/lexical-nodes/utils';
import type { SerializedEditorState } from 'lexical';
import { err, ok, type Result } from 'neverthrow';

/** As many characters of the markdown as the editor keeps for a preview. */
const PREVIEW_LENGTH = 200;

const asTree = (state: SerializedEditorState): SerializedTree =>
  state as unknown as SerializedTree;
const asState = (tree: SerializedTree): SerializedEditorState =>
  tree as unknown as SerializedEditorState;

export async function importMarkdownDocument(
  documents: IDocumentRepository,
  author: EditAuthor,
  input: { name: string; text: string; parentId: string | null }
): Promise<Result<{ id: string }, string>> {
  const created = await documents.create({
    title: input.name,
    parentId: input.parentId,
  });
  if (created.isErr()) return err(created.error);
  const id = created.value.id;

  const tree = asTree(markdownToState(input.text, ALL_TRANSFORMERS).state);
  const markdown = stateToMarkdown(asState(tree));
  const saved = await documents.save({
    id,
    tree,
    markdown,
    preview: markdown.slice(0, PREVIEW_LENGTH),
    author,
  });
  if (saved.isErr()) {
    // A document whose content never landed is an empty shell in the tree:
    // take it back rather than leave it. Best effort — the write failure is
    // the one worth reporting.
    await documents.softDelete(id);
    return err(saved.error);
  }
  return ok({ id });
}

export async function exportDocumentMarkdown(
  documents: IDocumentRepository,
  id: string
): Promise<Result<{ title: string; markdown: string }, string>> {
  const loaded = await documents.load(id);
  if (loaded.isErr()) return err(loaded.error);
  const { meta, content } = loaded.value;
  const markdown = content?.tree
    ? stateToMarkdown(asState(content.tree), EXTERNAL_TRANSFORMERS)
    : '';
  return ok({ title: meta.title, markdown });
}
