import { DocumentCrdt } from '@workspace/doc-crdt';
import { createHashEmbedder } from '@workspace/embedding/testing';
import { WINDOW_CHARS } from '@workspace/embedding';
import { describe, expect, it } from 'vitest';

import { deriveDocument, toVectorLiteral } from './derive.js';
import { titleFromMarkdown, treeToMarkdown } from './document-text.js';
import { decodeBytea } from './indexer.js';

/**
 * The derive pass end to end, without a database or a model download: real
 * CRDT bytes in, index rows out, with the deterministic embedder standing in
 * for the pinned model.
 */

const AUTHOR = { kind: 'user', id: 'u1' } as never;

/**
 * Builds document bytes the way a client would: a tree of paragraphs, folded
 * into a CRDT and exported as a snapshot.
 */
function documentBytes(paragraphs: string[]): Uint8Array {
  const crdt = DocumentCrdt.create();
  crdt.commitTree(
    {
      root: {
        type: 'root',
        $: { id: 'root' },
        children: paragraphs.map((text, i) => ({
          type: 'paragraph',
          $: { id: `p${i}` },
          children: [{ type: 'text', $: { id: `t${i}` }, text, format: 0 }],
        })),
      },
    } as never,
    AUTHOR
  );
  return crdt.exportSnapshot();
}

describe('deriveDocument', () => {
  it('derives chunks and a title from canonical bytes', async () => {
    const snapshot = documentBytes(['Meeting notes', 'We agreed to ship on Friday.']);

    const derived = await deriveDocument({ snapshot }, createHashEmbedder());

    expect(derived.title).toBe('Meeting notes');
    expect(derived.chunks).toHaveLength(1);
    expect(derived.chunks[0]?.ord).toBe(0);
    expect(derived.chunks[0]?.char_start).toBe(0);
    expect(derived.chunks[0]?.text).toContain('ship on Friday');
    // pgvector literal of a 384-dimension vector.
    expect(derived.chunks[0]?.embedding.startsWith('[')).toBe(true);
    expect(derived.chunks[0]?.embedding.split(',')).toHaveLength(384);
  });

  it('folds the update tail on top of the snapshot', async () => {
    // A document whose later edit lives only in the journal must be indexed
    // with that edit included — the snapshot alone is a stale document.
    const base = DocumentCrdt.create();
    base.commitTree(
      {
        root: {
          type: 'root',
          $: { id: 'root' },
          children: [
            {
              type: 'paragraph',
              $: { id: 'p0' },
              children: [{ type: 'text', $: { id: 't0' }, text: 'first', format: 0 }],
            },
          ],
        },
      } as never,
      AUTHOR
    );
    const snapshot = base.exportSnapshot();

    const updates: Uint8Array[] = [];
    const unsubscribe = base.onLocalUpdate((bytes) => updates.push(bytes));
    base.commitTree(
      {
        root: {
          type: 'root',
          $: { id: 'root' },
          children: [
            {
              type: 'paragraph',
              $: { id: 'p0' },
              children: [{ type: 'text', $: { id: 't0' }, text: 'first', format: 0 }],
            },
            {
              type: 'paragraph',
              $: { id: 'p1' },
              children: [
                { type: 'text', $: { id: 't1' }, text: 'appended later', format: 0 },
              ],
            },
          ],
        },
      } as never,
      AUTHOR
    );
    unsubscribe();
    expect(updates.length).toBeGreaterThan(0);

    const withoutTail = await deriveDocument({ snapshot }, createHashEmbedder());
    const withTail = await deriveDocument({ snapshot, updates }, createHashEmbedder());

    expect(withoutTail.chunks[0]?.text).not.toContain('appended later');
    expect(withTail.chunks[0]?.text).toContain('appended later');
  });

  it('windows a long document with the shared constants', async () => {
    const long = 'word '.repeat(WINDOW_CHARS); // comfortably past one window
    const derived = await deriveDocument(
      { snapshot: documentBytes([long]) },
      createHashEmbedder()
    );

    expect(derived.chunks.length).toBeGreaterThan(1);
    // Ordinals are dense and ascending: the write RPC keys rows by them.
    expect(derived.chunks.map((c) => c.ord)).toEqual(
      derived.chunks.map((_, i) => i)
    );
    expect(derived.chunks[1]?.char_start).toBeGreaterThan(0);
  });

  it('yields an empty, valid result for a document that was never written', async () => {
    const derived = await deriveDocument({ snapshot: null }, createHashEmbedder());

    expect(derived).toEqual({ title: '', chunks: [] });
  });
});

describe('titleFromMarkdown', () => {
  it('prefers the first heading', () => {
    expect(titleFromMarkdown('\n\n## Quarterly plan\n\nbody')).toBe('Quarterly plan');
  });

  it('falls back to the first non-empty line', () => {
    expect(titleFromMarkdown('\n\njust a paragraph\nmore')).toBe('just a paragraph');
  });

  it('is empty for an empty document', () => {
    expect(titleFromMarkdown('   \n\n')).toBe('');
  });
});

describe('treeToMarkdown', () => {
  it('renders nothing for a document with no tree', () => {
    expect(treeToMarkdown(null)).toBe('');
  });
});

describe('decodeBytea', () => {
  it('decodes the hex-escaped form the REST channel returns', () => {
    expect(decodeBytea('\\x0001ff')).toEqual(Uint8Array.from([0, 1, 255]));
  });

  it('passes through bytes and empty values', () => {
    const bytes = Uint8Array.from([7, 8]);
    expect(decodeBytea(bytes)).toBe(bytes);
    expect(decodeBytea('\\x')).toEqual(new Uint8Array(0));
    expect(decodeBytea(null)).toBeNull();
  });
});

describe('toVectorLiteral', () => {
  it('formats a vector the way pgvector parses it', () => {
    expect(toVectorLiteral(Float32Array.from([1, 0.5, 0]))).toBe('[1,0.5,0]');
  });
});
