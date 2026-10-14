import { createHeadlessEditor } from '@lexical/headless';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from 'lexical';
import { SupportedNodeTypes } from '@workspace/lexical-nodes';
import { describe, expect, it } from 'vitest';
import {
  getActiveHeadingIndex,
  headingsEqual,
  readHeadings,
  shouldShowOutline,
} from './outline.js';

function makeEditor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

function withDocument(editor: LexicalEditor, build: () => void) {
  editor.update(build, { discrete: true });
}

describe('readHeadings', () => {
  it('extracts top-level headings in document order, skipping empty ones', () => {
    const editor = makeEditor();
    withDocument(editor, () => {
      const root = $getRoot();
      root.clear();
      const h1 = $createHeadingNode('h1');
      h1.append($createTextNode('Intro'));
      const empty = $createHeadingNode('h2');
      const h2 = $createHeadingNode('h2');
      h2.append($createTextNode('Details'));
      const p = $createParagraphNode();
      p.append($createTextNode('body text'));
      root.append(h1, empty, h2, p);
    });

    const headings = editor.getEditorState().read(readHeadings);
    expect(headings).toEqual([
      { key: headings[0]!.key, level: 1, text: 'Intro' },
      { key: headings[1]!.key, level: 2, text: 'Details' },
    ]);
  });

  it('produces nodes that are really headings', () => {
    const editor = makeEditor();
    withDocument(editor, () => {
      const root = $getRoot();
      root.clear();
      const h1 = $createHeadingNode('h1');
      h1.append($createTextNode('Only heading'));
      root.append(h1);
    });

    const isHeading = editor
      .getEditorState()
      .read(() => $isHeadingNode($getRoot().getFirstChild()));
    expect(isHeading).toBe(true);
  });
});

describe('shouldShowOutline', () => {
  it('hides the outline below the minimum heading count', () => {
    expect(shouldShowOutline(0)).toBe(false);
    expect(shouldShowOutline(2)).toBe(false);
  });

  it('shows the outline at or above the minimum heading count', () => {
    expect(shouldShowOutline(3)).toBe(true);
    expect(shouldShowOutline(10)).toBe(true);
  });
});

describe('headingsEqual', () => {
  it('is true for the same headings in the same order', () => {
    const a = [{ key: '1', level: 1, text: 'A' }];
    const b = [{ key: '1', level: 1, text: 'A' }];
    expect(headingsEqual(a, b)).toBe(true);
  });

  it('is false when text, level, key, or length differ', () => {
    const base = [{ key: '1', level: 1, text: 'A' }];
    expect(headingsEqual(base, [{ key: '1', level: 1, text: 'B' }])).toBe(
      false
    );
    expect(headingsEqual(base, [{ key: '1', level: 2, text: 'A' }])).toBe(
      false
    );
    expect(headingsEqual(base, [{ key: '2', level: 1, text: 'A' }])).toBe(
      false
    );
    expect(headingsEqual(base, [])).toBe(false);
  });
});

describe('getActiveHeadingIndex', () => {
  it('returns -1 for no headings', () => {
    expect(getActiveHeadingIndex([], 100)).toBe(-1);
  });

  it('picks the last heading at or above the active line', () => {
    expect(getActiveHeadingIndex([0, 50, 150], 80)).toBe(1);
  });

  it('falls back to the first heading when the active line is above all of them', () => {
    expect(getActiveHeadingIndex([50, 150], 10)).toBe(0);
  });

  it('picks the last heading when the active line is past all of them', () => {
    expect(getActiveHeadingIndex([0, 50, 150], 500)).toBe(2);
  });
});
