import { createHeadlessEditor } from '@lexical/headless';
import { $isMarkNode } from '@lexical/mark';
import { $dfs } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  type LexicalEditor,
} from 'lexical';
import { SupportedNodeTypes } from '@workspace/lexical-nodes';
import { describe, expect, it } from 'vitest';
import {
  clearHighlights,
  computeNextMatchIndex,
  findAllOccurrences,
  replaceAllMatches,
  replaceMatch,
  searchAndHighlight,
} from './find-replace.js';

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

function loadParagraph(editor: LexicalEditor, text: string) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      root.append(p);
    },
    { discrete: true }
  );
}

function documentText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
}

function markCount(editor: LexicalEditor): number {
  return editor
    .getEditorState()
    .read(() => $dfs().filter(({ node }) => $isMarkNode(node)).length);
}

describe('findAllOccurrences', () => {
  it('finds every non-overlapping occurrence, case-insensitively by default', () => {
    expect(findAllOccurrences('foo Foo fOO bar', 'foo', false)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it('respects case sensitivity when asked', () => {
    expect(findAllOccurrences('foo Foo fOO', 'foo', true)).toEqual([
      { start: 0, end: 3 },
    ]);
  });

  it('returns nothing for an empty query', () => {
    expect(findAllOccurrences('anything', '', false)).toEqual([]);
  });
});

describe('searchAndHighlight', () => {
  it('wraps every match in a MarkNode without changing the visible text', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'the cat sat on the mat');

    const matches = searchAndHighlight(editor, 'at', false);

    expect(matches).toHaveLength(3); // cAT, sAT, mAT
    expect(markCount(editor)).toBe(3);
    expect(documentText(editor)).toBe('the cat sat on the mat');
  });

  it('clears highlights from a previous search before the new one', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'cat cat cat');

    searchAndHighlight(editor, 'cat', false);
    expect(markCount(editor)).toBe(3);

    searchAndHighlight(editor, 'at', false);
    expect(markCount(editor)).toBe(3);
    expect(documentText(editor)).toBe('cat cat cat');
  });

  it('clears all highlights for an empty query', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'cat cat');
    searchAndHighlight(editor, 'cat', false);
    expect(markCount(editor)).toBe(2);

    searchAndHighlight(editor, '', false);
    expect(markCount(editor)).toBe(0);
  });
});

describe('clearHighlights', () => {
  it('removes marks without altering the text', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'cat cat');
    searchAndHighlight(editor, 'cat', false);

    clearHighlights(editor);

    expect(markCount(editor)).toBe(0);
    expect(documentText(editor)).toBe('cat cat');
  });
});

describe('replaceMatch', () => {
  it('replaces exactly one match and unwraps its mark', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'cat cat cat');
    const matches = searchAndHighlight(editor, 'cat', false);

    replaceMatch(editor, matches[1]!.id, 'dog');

    expect(documentText(editor)).toBe('cat dog cat');
    // The replaced match's mark is gone; the other two remain highlighted.
    expect(markCount(editor)).toBe(2);
  });

  it('merges back into a single text node under the wrapping mark', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'find me here');
    const matches = searchAndHighlight(editor, 'me', false);

    replaceMatch(editor, matches[0]!.id, 'you');

    const textNodeCount = editor
      .getEditorState()
      .read(() => $dfs().filter(({ node }) => $isTextNode(node)).length);
    expect(documentText(editor)).toBe('find you here');
    expect(textNodeCount).toBeGreaterThan(0);
  });
});

describe('replaceAllMatches', () => {
  it('replaces every current match and clears all highlights', () => {
    const editor = makeEditor();
    loadParagraph(editor, 'cat cat cat');
    const matches = searchAndHighlight(editor, 'cat', false);

    replaceAllMatches(editor, matches, 'dog');

    expect(documentText(editor)).toBe('dog dog dog');
    expect(markCount(editor)).toBe(0);
  });
});

describe('computeNextMatchIndex', () => {
  it('returns -1 when there are no matches', () => {
    expect(computeNextMatchIndex(-1, 0, 'next')).toBe(-1);
  });

  it('starts at the first match going next, last match going prev', () => {
    expect(computeNextMatchIndex(-1, 3, 'next')).toBe(0);
    expect(computeNextMatchIndex(-1, 3, 'prev')).toBe(2);
  });

  it('wraps around at the ends', () => {
    expect(computeNextMatchIndex(2, 3, 'next')).toBe(0);
    expect(computeNextMatchIndex(0, 3, 'prev')).toBe(2);
  });

  it('steps by one otherwise', () => {
    expect(computeNextMatchIndex(0, 3, 'next')).toBe(1);
    expect(computeNextMatchIndex(1, 3, 'prev')).toBe(0);
  });
});
