/**
 * @file The links plugin against the editor's real node set.
 *
 * These specs drive a wrapper built from the registered vocabulary, because
 * that is the only way the defect they guard is visible: creating a node the
 * editor was not configured with throws inside `editor.update()`, Lexical
 * discards the WHOLE update, and the wrapper's `onError` swallows the throw.
 * A spec that builds its own editor with a hand-picked node list would pass
 * while the product loses the edit, so the console spy asserting zero errors
 * is part of the assertion, not diagnostics.
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { $isLinkNode, type LinkNode } from '@lexical/link';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import { linksPlugin, UNLINK_COMMAND } from './linksPlugin';

let wrapper: ReturnType<typeof createLexicalWrapper>;
let editor: LexicalEditor;
let errors: unknown[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'links-spec',
    isInteractable: () => true,
  });
  editor = wrapper.editor;
  wrapper.plugins.use(linksPlugin({}));
});

afterEach(() => {
  wrapper.cleanup();
  vi.restoreAllMocks();
});

/** Every node in the document, depth first. */
function collect(node: LexicalNode, out: LexicalNode[] = []): LexicalNode[] {
  out.push(node);
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) collect(child, out);
  }
  return out;
}

function readNodes<T>(read: (nodes: LexicalNode[]) => T): T {
  return editor.getEditorState().read(() => read(collect($getRoot())));
}

function links(): LinkNode[] {
  return readNodes((nodes) => nodes.filter($isLinkNode));
}

/** URL + text of every link, read inside the editor state. */
function linkSummaries(): Array<{ url: string; text: string }> {
  return readNodes((nodes) =>
    nodes
      .filter($isLinkNode)
      .map((link) => ({ url: link.getURL(), text: link.getTextContent() }))
  );
}

/** Select the text inside the first link, the way the toolbar does. */
function selectInsideFirstLink() {
  editor.update(
    () => {
      const link = collect($getRoot()).find($isLinkNode);
      const text = link?.getFirstChild();
      if (!$isTextNode(text)) throw new Error('link has no text child');
      text.select(0, text.getTextContentSize());
    },
    { discrete: true }
  );
}

/** Command dispatch is batched; force the pending update to land. */
function flush() {
  editor.update(() => {}, { discrete: true });
}

function typeText(text: string) {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      $getRoot().clear().append(paragraph);
    },
    { discrete: true }
  );
}

describe('links plugin against the registered vocabulary', () => {
  it('auto-links a URL in typed text without losing the update', () => {
    typeText('see https://example.com here');

    expect(errors).toEqual([]);
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent())
    ).toBe('see https://example.com here');
    expect(linkSummaries()).toEqual([
      { url: 'https://example.com', text: 'https://example.com' },
    ]);
  });

  it('unlinks a URL-texted link and leaves the text plain', () => {
    typeText('see https://example.com here');
    expect(links()).toHaveLength(1);

    selectInsideFirstLink();
    editor.dispatchCommand(UNLINK_COMMAND, undefined);
    flush();

    expect(errors).toEqual([]);
    expect(links()).toEqual([]);
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent())
    ).toBe('see https://example.com here');
  });

  it('does not re-link text that was explicitly unlinked', () => {
    typeText('see https://example.com here');
    selectInsideFirstLink();
    editor.dispatchCommand(UNLINK_COMMAND, undefined);

    // Any later edit re-runs the text transform over the same text; the
    // unlinked marker is what has to survive it.
    editor.update(
      () => {
        const text = collect($getRoot()).filter($isTextNode).at(-1);
        text?.setTextContent(`${text.getTextContent()}!`);
      },
      { discrete: true }
    );

    expect(errors).toEqual([]);
    expect(links()).toEqual([]);
  });
});
