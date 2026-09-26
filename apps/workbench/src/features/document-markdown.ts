/**
 * @file Markdown in and out of the document port, headlessly.
 *
 * Import produces the TREE the editor mounts: a document is its tree, and
 * the markdown beside it is derived from that tree the way every save
 * derives it, so what the editor opens is exactly what a save would have
 * written. The import reads both markdown forms — the lossless internal tags
 * and the portable links — because a file may come from either side.
 *
 * Export renders a tree in the portable form: an own node degrades to what
 * any reader understands. The tree comes from the open editor when there is
 * one — the port lags it by a debounce, a write and a retry — and from the
 * port otherwise.
 */
import {
  type EditAuthor,
  type IDocumentRepository,
  type IFileRepository,
  newId,
  type SerializedTree,
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

/** The two ports an import writes through: the document, and its node in the tree. */
export type DocumentPorts = {
  documents: IDocumentRepository;
  files: Pick<IFileRepository, 'softDelete'>;
};

/** Where an export asks for the tree of a document an editor holds open. */
export type OpenDocuments = {
  read(documentId: string): SerializedTree | null;
};

export async function importMarkdownDocument(
  { documents, files }: DocumentPorts,
  author: EditAuthor,
  input: { name: string; text: string; parentId: string | null }
): Promise<Result<{ id: string }, string>> {
  // Parsed before anything is created, so a conversion that throws leaves
  // nothing behind to take back.
  const tree = asTree(markdownToState(input.text, ALL_TRANSFORMERS).state);
  const markdown = stateToMarkdown(asState(tree));

  // The importer mints the node's id itself: the explorer lists graph nodes,
  // not document rows, so this is the id that can take the document back.
  const nodeId = newId('knowledgeResource');
  const created = await documents.create({
    title: input.name,
    parentId: input.parentId,
    nodeId,
  });
  if (created.isErr()) return err(created.error);
  const id = created.value.id;

  const saved = await documents.save({
    id,
    tree,
    markdown,
    preview: markdown.slice(0, PREVIEW_LENGTH),
    author,
  });
  if (saved.isErr()) {
    // A document whose content never landed is an empty shell in the tree.
    // Taking back the NODE is what removes it from the explorer; the
    // document row alone would leave a live entry that opens to nothing.
    const taken = await files.softDelete(nodeId);
    return err(
      taken.isErr()
        ? `${saved.error}; the empty document could not be removed: ${taken.error}`
        : saved.error
    );
  }
  return ok({ id });
}

export async function exportDocumentMarkdown(
  documents: IDocumentRepository,
  id: string,
  open: OpenDocuments
): Promise<Result<{ title: string; markdown: string }, string>> {
  const loaded = await documents.load(id);
  if (loaded.isErr()) return err(loaded.error);
  const { meta, content } = loaded.value;
  const tree = open.read(id) ?? content?.tree ?? null;
  const markdown = tree
    ? stateToMarkdown(asState(tree), EXTERNAL_TRANSFORMERS)
    : '';
  return ok({ title: meta.title, markdown });
}
