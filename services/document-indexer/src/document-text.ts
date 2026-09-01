import './prism-global.js';

import { $convertToMarkdownString } from '@lexical/markdown';
import { createEditingSession, loadSnapshot } from '@workspace/ai-ops/ai-toolkit';
import { DocumentCrdt, type SerializedTree } from '@workspace/doc-crdt';
import { INTERNAL_TRANSFORMERS } from '@workspace/lexical-nodes/transformers';
import type { SerializedEditorState } from 'lexical';

/**
 * Turning the canonical document bytes back into text, server-side.
 *
 * This is the one server component that OPENS documents. Everywhere else the
 * CRDT bytes are opaque — the sync tables store and hand them back without
 * ever interpreting them. Here they are folded into a document tree and then
 * rendered with the SAME transformers the editor uses, so the text the index
 * holds reads exactly as the editor would have serialized it.
 *
 * Deriving here rather than accepting client-pushed text is deliberate: a
 * client projection would be a second representation whose staleness depends
 * on which replica pushed last, and whose contents nothing could check
 * against the canonical bytes.
 */

/** Folds a stored snapshot plus its update tail into one document. */
export function foldDocument(input: {
  snapshot?: Uint8Array | null;
  updates?: Uint8Array[];
}): SerializedTree | null {
  const crdt = DocumentCrdt.restore(input);
  return crdt.toTree();
}

/**
 * Renders a document tree as markdown.
 *
 * Returns an empty string for a document that has never been written — an
 * empty index entry, not an error: an empty document is a legitimate state
 * and must not stall the worker's watermark.
 */
export function treeToMarkdown(tree: SerializedTree | null): string {
  if (!tree) return '';
  const session = createEditingSession();
  // The tree is structurally an editor state root; the domain type describes
  // the same JSON without depending on the editor library.
  loadSnapshot(session, { root: tree.root } as unknown as SerializedEditorState);
  return session.editor
    .getEditorState()
    .read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

/**
 * The document's title, as search results should show it.
 *
 * The server has no title column for a synced document — the title lives
 * inside the CRDT, like the rest of the content. Taking the first heading (or
 * failing that the first non-empty line) mirrors what the editor shows as the
 * document's name, and it is captured at derive time because no other server
 * path can read it.
 */
export function titleFromMarkdown(markdown: string): string {
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    return (heading?.[1] ?? line).trim().slice(0, 200);
  }
  return '';
}
