/**
 * Forward compatibility (ADR 0032 §5.3): an unrecognised tag must survive a
 * round trip byte for byte, and a malformed known tag must degrade to the
 * same sink rather than being lost.
 */
import { createHeadlessEditor } from '@lexical/headless';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { INTERNAL_TRANSFORMERS } from '../transformers';

function editor(): LexicalEditor {
  return createHeadlessEditor({
    nodes: [...SupportedNodeTypes],
    onError: (error) => {
      throw error;
    },
  });
}

function roundTrip(markdown: string): string {
  const instance = editor();
  instance.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
    },
    { discrete: true }
  );
  let out = '';
  instance.getEditorState().read(() => {
    out = $convertToMarkdownString(INTERNAL_TRANSFORMERS);
  });
  return out;
}

function nodeTypes(markdown: string): string[] {
  const instance = editor();
  instance.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
    },
    { discrete: true }
  );
  // Element transformers append into the block they matched in, so the node
  // we care about is generally not a direct child of the root.
  return instance.getEditorState().read(() => {
    const types: string[] = [];
    const visit = (node: ReturnType<typeof $getRoot>) => {
      for (const child of node.getChildren()) {
        types.push(child.getType());
        const asElement = child as unknown as ReturnType<typeof $getRoot>;
        if (typeof asElement.getChildren === 'function') visit(asElement);
      }
    };
    visit($getRoot());
    return types;
  });
}

describe('unknown tags', () => {
  it('round-trips a tag this build has never heard of', () => {
    const source = '<x-future>{"anything":1}</x-future>';
    expect(roundTrip(source)).toContain(source);
  });

  it('captures it as an unknown embed, not as text', () => {
    expect(nodeTypes('<x-future>{"a":1}</x-future>')).toContain(
      'unknown-embed'
    );
  });

  it('preserves the raw source exactly, including odd payloads', () => {
    const source = '<x-weird>not json at all <> &</x-weird>';
    expect(roundTrip(source)).toContain(source);
  });
});

describe('malformed known tags', () => {
  it('degrades a broken file tag to the sink instead of losing it', () => {
    const types = nodeTypes('<x-file>{ this is not json }</x-file>');
    expect(types).toContain('unknown-embed');
    expect(types).not.toContain('file');
  });

  it('degrades a file tag with no hash', () => {
    const types = nodeTypes('<x-file>{"fileName":"a.pdf"}</x-file>');
    expect(types).toContain('unknown-embed');
  });

  it('degrades a broken image tag', () => {
    const types = nodeTypes('<x-image>{"mime":"image/png"}</x-image>');
    expect(types).toContain('unknown-embed');
    expect(types).not.toContain('image');
  });

  it('keeps the broken source recoverable in the output', () => {
    const source = '<x-file>{ broken }</x-file>';
    expect(roundTrip(source)).toContain(source);
  });
});
