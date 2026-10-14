/**
 * The two list behaviours the stock transformers lack (ADR 0032 §5.5), and
 * the headless markdown round trip (§5.8).
 */
import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $isListNode } from '@lexical/list';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $getId } from '../plugins/nodeIdPlugin';
import { INTERNAL_TRANSFORMERS } from '../transformers';
import { markdownToState, stateToMarkdown } from '../utils';

function parse(markdown: string): LexicalEditor {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
    },
    { discrete: true }
  );
  return editor;
}

describe('a list marker in a heading', () => {
  it('leaves the heading a heading', () => {
    const editor = parse('# 1. Not a list');
    const stillHeading = editor
      .getEditorState()
      .read(() => $isHeadingNode($getRoot().getFirstChild()));
    expect(stillHeading).toBe(true);
  });

  it('does not produce a list node', () => {
    const editor = parse('## - not a bullet');
    const hasList = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .some((child) => $isListNode(child))
    );
    expect(hasList).toBe(false);
  });
});

describe('ordered list numbering', () => {
  it('keeps a list that starts at 1 at its default', () => {
    const editor = parse('1. one\n2. two');
    const start = editor.getEditorState().read(() => {
      const list = $getRoot().getFirstChild();
      return $isListNode(list) ? list.getStart() : null;
    });
    expect(start).toBe(1);
  });

  it('honours a list written to start at another number', () => {
    const editor = parse('5. five\n6. six');
    const start = editor.getEditorState().read(() => {
      const list = $getRoot().getFirstChild();
      return $isListNode(list) ? list.getStart() : null;
    });
    expect(start).toBe(5);
  });
});

describe('the headless round trip', () => {
  it('returns a state with every node ided', () => {
    const { state } = markdownToState('# Title\n\nBody text.\n\n- a\n- b');

    const check = (node: { $?: { id?: unknown }; children?: unknown[] }) => {
      expect(typeof node.$?.id).toBe('string');
      for (const child of (node.children ?? []) as Array<typeof node>) {
        check(child);
      }
    };
    for (const child of state.root.children as Array<{
      $?: { id?: unknown };
      children?: unknown[];
    }>) {
      check(child);
    }
  });

  it('round-trips markdown back to equivalent markdown', () => {
    const source = '# Title\n\nSome body text.';
    const { state } = markdownToState(source);
    expect(stateToMarkdown(state)).toContain('# Title');
    expect(stateToMarkdown(state)).toContain('Some body text.');
  });

  it('reports the ids it assigned', () => {
    const { state, ids } = markdownToState('A paragraph.');
    expect(ids.idToNodeKeyMap.size).toBeGreaterThan(0);
    const first = state.root.children[0] as { $?: { id?: unknown } };
    expect(ids.idToNodeKeyMap.has(first.$?.id as string)).toBe(true);
  });

  it('preserves ids across a state round trip', () => {
    const { state } = markdownToState('# Stable');
    const markdown = stateToMarkdown(state);
    expect(markdown).toContain('# Stable');

    const editor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes],
      onError: (error) => {
        throw error;
      },
    });
    editor.setEditorState(editor.parseEditorState(state));
    const ids = editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((child) => $getId(child))
    );
    const original = (
      state.root.children as Array<{ $?: { id?: unknown } }>
    ).map((child) => child.$?.id);
    expect(ids).toEqual(original);
  });
});
