/**
 * Search highlights are not document content.
 *
 * Find wraps each match in a MarkNode so the UI can address it; those nodes
 * live in the editor's tree like any other, and would be written to the
 * document by a host that serialises the tree. The host asks this module to
 * take them out of a serialised tree before persisting — and only THEM: a
 * mark that is not a search highlight is content and stays.
 */
import { describe, expect, it } from 'vitest';
import { matchId, stripFindHighlights } from './find-replace.js';

const text = (t: string, format = 0) => ({
  type: 'text',
  text: t,
  format,
  style: '',
  mode: 'normal',
  detail: 0,
  version: 1,
});

describe('stripping search highlights from a serialised tree', () => {
  it('unwraps the highlight marks and joins the text they split', () => {
    const tree = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              text('say '),
              { type: 'mark', ids: [matchId(0)], children: [text('hello')] },
              text(' world'),
            ],
          },
        ],
      },
    };
    expect(stripFindHighlights(tree)).toEqual({
      root: {
        type: 'root',
        children: [{ type: 'paragraph', children: [text('say hello world')] }],
      },
    });
  });

  it('leaves a mark that is not a search highlight, and differently formatted neighbours, alone', () => {
    const tree = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              text('a'),
              { type: 'mark', ids: ['comment-1'], children: [text('b')] },
              { type: 'mark', ids: [matchId(3)], children: [text('c', 1)] },
              text('d'),
            ],
          },
        ],
      },
    };
    expect(stripFindHighlights(tree)).toEqual({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              text('a'),
              { type: 'mark', ids: ['comment-1'], children: [text('b')] },
              text('c', 1),
              text('d'),
            ],
          },
        ],
      },
    });
  });

  it('never joins text that differs in anything but its text, node state included', () => {
    const unlinked = { ...text('https://a.test'), $: { unlinked: true } };
    const tree = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              text('see '),
              { type: 'mark', ids: [matchId(0)], children: [text('this')] },
              { ...text(' at '), $: { unlinked: true } },
              unlinked,
            ],
          },
        ],
      },
    };
    expect(stripFindHighlights(tree)).toEqual({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              text('see this'),
              // Same text shape, different state: two nodes before, two after.
              { ...text(' at '), $: { unlinked: true } },
              unlinked,
            ],
          },
        ],
      },
    });
  });

  it('tells nested node state apart across a highlight boundary', () => {
    const paragraph = (second: Record<string, unknown>) => ({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'mark',
                ids: [matchId(0)],
                children: [
                  { ...text('https://a.test'), $: { unlinked: true } },
                ],
              },
              { ...text('/path'), ...second },
            ],
          },
        ],
      },
    });
    // Same state on both sides of the boundary: one node again.
    expect(stripFindHighlights(paragraph({ $: { unlinked: true } }))).toEqual({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { ...text('https://a.test/path'), $: { unlinked: true } },
            ],
          },
        ],
      },
    });
    // Different nested values: two nodes, each with its own state.
    expect(stripFindHighlights(paragraph({ $: { unlinked: false } }))).toEqual({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { ...text('https://a.test'), $: { unlinked: true } },
              { ...text('/path'), $: { unlinked: false } },
            ],
          },
        ],
      },
    });
  });

  it('joins only what a highlight split, not neighbours that were already apart', () => {
    const tree = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              text('one'),
              text('two'),
              { type: 'mark', ids: [matchId(0)], children: [text('three')] },
            ],
          },
        ],
      },
    };
    expect(stripFindHighlights(tree)).toEqual({
      root: {
        type: 'root',
        children: [
          { type: 'paragraph', children: [text('one'), text('twothree')] },
        ],
      },
    });
  });

  it('returns the same object when there is nothing to strip', () => {
    const tree = {
      root: {
        type: 'root',
        children: [{ type: 'paragraph', children: [text('x')] }],
      },
    };
    expect(stripFindHighlights(tree)).toBe(tree);
  });
});
