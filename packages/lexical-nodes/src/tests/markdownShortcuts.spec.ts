/**
 * The block rules on the TYPING path.
 *
 * The markdown shortcut plugin hands an element rule the paragraph the user
 * is typing in, with whatever followed the matched text still inside it. A
 * rule that read the tag from a line of its own may take the paragraph's
 * place only when the paragraph holds nothing else; what the user wrote
 * after the tag is theirs and stays.
 */
import { createHeadlessEditor } from '@lexical/headless';
import { registerMarkdownShortcuts } from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS } from '../transformers';

const HASH = 'a'.repeat(64);
const IMAGE = `<x-image>{"hash":"${HASH}","mime":"image/png","width":1,"height":1,"alt":"cat"}</x-image>`;
const CARD =
  '<x-resource>{"resourceId":"knr_1","kind":"document","label":"Spec","display":"card"}</x-resource>';
const CHIP =
  '<x-resource>{"resourceId":"knr_1","kind":"document","label":"Spec","display":"inline"}</x-resource>';

type Node = { type: string; text?: string; format?: number; children?: Node[] };

function editor(): LexicalEditor {
  const instance = createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
  registerMarkdownShortcuts(instance, ALL_TRANSFORMERS);
  return instance;
}

/** `type[:text][*]` per node, `*` marking bold; one line per top-level block. */
function shape(instance: LexicalEditor): string[] {
  const one = (n: Node) =>
    n.type +
    (n.text !== undefined ? `:${JSON.stringify(n.text)}` : '') +
    (n.format ? '*' : '');
  const root = instance.getEditorState().toJSON().root as unknown as Node;
  return root.children!.map((b) =>
    [one(b), ...(b.children ?? []).map(one)].join(' > ')
  );
}

/**
 * Type `typed` at the end of the first text of a paragraph whose remaining
 * children are `rest`, the way the shortcut plugin sees a keystroke. The rest
 * is bold so it stays a node of its own: Lexical merges neighbouring text of
 * one format into one node, and the shortcut only converts a text node that
 * is the whole tag.
 */
async function typeAfter(
  instance: LexicalEditor,
  typed: string,
  rest: Array<{ text: string; bold?: boolean }>,
  before: string[] = []
): Promise<void> {
  instance.update(
    () => {
      const root = $getRoot();
      root.clear();
      for (const line of before) {
        root.append($createParagraphNode().append($createTextNode(line)));
      }
      const head = $createTextNode(typed);
      const paragraph = $createParagraphNode().append(head);
      for (const { text, bold } of rest) {
        const node = $createTextNode(text);
        if (bold) node.toggleFormat('bold');
        paragraph.append(node);
      }
      root.append(paragraph);
      head.select(typed.length, typed.length);
    },
    { discrete: true }
  );
  // The keystroke the shortcut reacts to: a space after the tag.
  instance.update(
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(' ');
    },
    { discrete: true }
  );
  // The shortcut runs its own update from the listener; let it commit.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('a block tag typed in front of other content', () => {
  it('keeps what followed the tag when an image takes shape', async () => {
    const instance = editor();
    await typeAfter(instance, IMAGE, [{ text: 'KEEP', bold: true }]);
    expect(shape(instance)).toEqual(['image', 'paragraph > text:"KEEP"*']);
  });

  it('keeps what followed the tag when a card takes shape', async () => {
    const instance = editor();
    await typeAfter(instance, CARD, [{ text: 'KEEP', bold: true }]);
    expect(shape(instance)).toEqual([
      'resource-mention',
      'paragraph > text:"KEEP"*',
    ]);
  });

  it('keeps what followed an unknown tag', async () => {
    const instance = editor();
    await typeAfter(instance, '<x-future>{"a":1}</x-future>', [
      { text: 'KEEP', bold: true },
    ]);
    expect(shape(instance)).toEqual([
      'unknown-embed',
      'paragraph > text:"KEEP"*',
    ]);
  });

  it('puts an inline chip where the tag was, in front of the rest', async () => {
    const instance = editor();
    await typeAfter(instance, CHIP, [{ text: 'KEEP', bold: true }]);
    expect(shape(instance)).toEqual([
      'paragraph > resource-mention > text:"KEEP"*',
    ]);
  });
});

describe('a block tag typed on the last line', () => {
  it('leaves the cursor a paragraph to continue in', async () => {
    const instance = editor();
    await typeAfter(instance, IMAGE, [], ['intro']);
    expect(shape(instance)).toEqual([
      'paragraph > text:"intro"',
      'image',
      'paragraph',
    ]);
    const anchor = instance.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection)
        ? selection.anchor.getNode().getType()
        : null;
    });
    expect(anchor).toBe('paragraph');
  });

  it('takes the line when another block follows', async () => {
    const instance = editor();
    // Typing inside an existing document: the paragraph after is the user's.
    instance.update(
      () => {
        const root = $getRoot();
        root.clear();
        const head = $createTextNode(IMAGE);
        root.append($createParagraphNode().append(head));
        root.append($createParagraphNode().append($createTextNode('after')));
        head.select(IMAGE.length, IMAGE.length);
      },
      { discrete: true }
    );
    instance.update(
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(' ');
      },
      { discrete: true }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shape(instance)).toEqual(['image', 'paragraph > text:"after"']);
  });
});
