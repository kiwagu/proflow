/**
 * The internal `<x-*>` tag forms, round-tripped through markdown.
 *
 * Two rules are pinned here. A block tag claims a line only when it IS the
 * line: a tag in the middle of a sentence belongs to the text-match rules, or
 * stays text — never to a block rule that would cut the line's head off and
 * push the node to the end. And an own node parsed from a line of its own is
 * a block, so the same rule that read it can write it back.
 */
import type { SerializedEditorState } from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '../transformers';
import { markdownToState, stateToMarkdown } from '../utils';

const HASH = 'a'.repeat(64);
const INLINE_MENTION =
  '<x-resource>{"resourceId":"knr_1","kind":"document","label":"Spec","display":"inline"}</x-resource>';
const CARD_MENTION =
  '<x-resource>{"resourceId":"knr_1","kind":"document","label":"Spec","display":"card"}</x-resource>';
const IMAGE = `<x-image>{"hash":"${HASH}","mime":"image/png","width":640,"height":480,"alt":"cat"}</x-image>`;
const FILE = `<x-file>{"hash":"${HASH}","fileName":"a.pdf","mimeType":"application/pdf","size":12}</x-file>`;

type Node = {
  type: string;
  text?: string;
  resourceId?: string;
  display?: string;
  children?: Node[];
};

/** `type[:text|#id/display]` per node, one line per top-level block. */
function shape(state: SerializedEditorState): string[] {
  const one = (n: Node): string =>
    n.type +
    (n.text !== undefined ? `:${JSON.stringify(n.text)}` : '') +
    (n.resourceId ? `#${n.resourceId}/${n.display}` : '');
  return (state.root as unknown as Node).children!.map((block) =>
    [one(block), ...(block.children ?? []).map(one)].join(' > ')
  );
}

function roundTrip(markdown: string, list = INTERNAL_TRANSFORMERS) {
  const { state } = markdownToState(markdown, list);
  return {
    shape: shape(state),
    internal: stateToMarkdown(state, INTERNAL_TRANSFORMERS),
    external: stateToMarkdown(state, EXTERNAL_TRANSFORMERS),
  };
}

describe('an inline mention inside a sentence', () => {
  it('keeps its place in the middle of the line', () => {
    const r = roundTrip(`see ${INLINE_MENTION} now`);
    expect(r.shape).toEqual([
      'paragraph > text:"see " > resource-mention#knr_1/inline > text:" now"',
    ]);
    expect(r.internal).toBe(`see ${INLINE_MENTION} now`);
    expect(r.external).toBe('see [Spec](resource://knr_1) now');
  });

  it('keeps its place at the start of the line', () => {
    const r = roundTrip(`${INLINE_MENTION} now`);
    expect(r.shape).toEqual([
      'paragraph > resource-mention#knr_1/inline > text:" now"',
    ]);
    expect(r.internal).toBe(`${INLINE_MENTION} now`);
    expect(r.external).toBe('[Spec](resource://knr_1) now');
  });

  it('stands alone on its line as an inline node, not a card', () => {
    const r = roundTrip(INLINE_MENTION);
    expect(r.shape).toEqual(['paragraph > resource-mention#knr_1/inline']);
    expect(r.internal).toBe(INLINE_MENTION);
    expect(r.external).toBe('[Spec](resource://knr_1)');
  });
});

describe('a card mention on a line of its own', () => {
  it('is a block, and the internal form writes it back unchanged', () => {
    const r = roundTrip(CARD_MENTION);
    expect(r.shape).toEqual(['resource-mention#knr_1/card']);
    expect(r.internal).toBe(CARD_MENTION);
    expect(r.external).toBe('[Spec](resource://knr_1)');
  });
});

describe('block tags that appear in the middle of a sentence', () => {
  it('leave an image tag as the text it was, rather than cutting the line', () => {
    const r = roundTrip(`see ${IMAGE} now`);
    expect(r.shape).toEqual([
      `paragraph > text:${JSON.stringify(`see ${IMAGE} now`)}`,
    ]);
    expect(r.internal).toBe(`see ${IMAGE} now`);
  });

  it('leave an unknown tag as the text it was', () => {
    const line = 'see <x-future>{"a":1}</x-future> now';
    const r = roundTrip(line);
    expect(r.shape).toEqual([`paragraph > text:${JSON.stringify(line)}`]);
    expect(r.internal).toBe(line);
  });
});

describe('block tags on a line of their own', () => {
  it('round-trip an image through the internal form', () => {
    const r = roundTrip(IMAGE);
    expect(r.shape).toEqual(['image']);
    expect(r.internal).toBe(IMAGE);
    expect(r.external).toBe(`![cat](blob://${HASH})`);
  });

  it('round-trip a file through the internal form', () => {
    const r = roundTrip(FILE);
    expect(r.shape).toEqual(['file']);
    expect(r.internal).toBe(FILE);
    expect(r.external).toBe(`[a.pdf](blob://${HASH})`);
  });

  it('round-trip an unknown tag byte for byte', () => {
    const line = '<x-future>{"a":1}</x-future>';
    const r = roundTrip(line);
    expect(r.shape).toEqual(['unknown-embed']);
    expect(r.internal).toBe(line);
    expect(r.external).toBe(line);
  });
});

describe('the portable forms on a line of their own', () => {
  it('read an image link as a block and write it back', () => {
    const r = roundTrip(`![cat](blob://${HASH})`, EXTERNAL_TRANSFORMERS);
    expect(r.shape).toEqual(['image']);
    expect(r.external).toBe(`![cat](blob://${HASH})`);
  });

  it('read a file link as a block and write it back', () => {
    const r = roundTrip(`[a.pdf](blob://${HASH})`, EXTERNAL_TRANSFORMERS);
    expect(r.shape).toEqual(['file']);
    expect(r.external).toBe(`[a.pdf](blob://${HASH})`);
  });

  it('read a resource link as an inline chip, since the link carries no display', () => {
    const r = roundTrip('[Spec](resource://knr_1)', EXTERNAL_TRANSFORMERS);
    expect(r.shape).toEqual(['paragraph > resource-mention#knr_1/inline']);
    expect(r.external).toBe('[Spec](resource://knr_1)');
    expect(r.internal).toBe(INLINE_MENTION);
  });
});

describe('the agent path: the internal form re-imports to itself', () => {
  it('is a fixed point for a document mixing every placement', () => {
    const source = [
      `Intro with ${INLINE_MENTION} mid-sentence.`,
      '',
      CARD_MENTION,
      '',
      IMAGE,
      '',
      `| ${INLINE_MENTION} | ${FILE} |`,
      '| --- | --- |',
      `| ${IMAGE} | plain |`,
    ].join('\n');
    const once = roundTrip(source).internal;
    const twice = roundTrip(once).internal;
    expect(once).toBe(source);
    expect(twice).toBe(once);
  });
});

describe('a mention inside a table cell', () => {
  const table = (cell: string) => `| ${cell} | y |\n| --- | --- |\n| a | b |`;

  it('is written in the form the caller chose, internal or external', () => {
    const r = roundTrip(table(INLINE_MENTION));
    expect(r.internal).toContain(INLINE_MENTION);
    expect(r.internal).not.toContain('resource://');
    expect(r.external).toContain('[Spec](resource://knr_1)');
    expect(r.external).not.toContain('<x-resource');
  });

  it('is read in the portable form by the import-anything list and written in either', () => {
    const r = roundTrip(table('[Plan](resource://knr_2)'), ALL_TRANSFORMERS);
    expect(r.external).toContain('[Plan](resource://knr_2)');
    expect(r.internal).toContain('"resourceId":"knr_2"');
    expect(r.internal).not.toContain('resource://');
  });

  it('keeps the form for a block in a cell too: an image tag is the cell', () => {
    const r = roundTrip(table(IMAGE));
    expect(r.internal).toContain(`| ${IMAGE} | y |`);
    expect(r.external).toContain(`| ![cat](blob://${HASH}) | y |`);
  });

  it('keeps the form through a table nested in a cell', () => {
    // Only a tree can nest a table; the markdown form has no syntax for it.
    const { state } = markdownToState(table(INLINE_MENTION));
    const outer = (state.root as unknown as Node).children![0]!;
    const cell = outer.children![1]!.children![0]!;
    cell.children = [structuredClone(outer)];
    const internal = stateToMarkdown(state, INTERNAL_TRANSFORMERS);
    const external = stateToMarkdown(state, EXTERNAL_TRANSFORMERS);
    // Once from the outer cell, once from the nested one — both in the form
    // the caller chose.
    expect(internal.split(INLINE_MENTION)).toHaveLength(3);
    expect(internal).not.toContain('resource://');
    expect(external.split('[Spec](resource://knr_1)')).toHaveLength(3);
    expect(external).not.toContain('<x-resource');
  });
});
