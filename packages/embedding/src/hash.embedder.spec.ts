import { describe, expect, it } from 'vitest';
import { createHashEmbedder } from './hash.embedder.js';

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
};

describe('hash embedder', () => {
  const embedder = createHashEmbedder();

  it('is deterministic and unit-norm', async () => {
    const [a] = await embedder.embed(['same text'], 'passage');
    const [b] = await embedder.embed(['same text'], 'query');
    expect(a).toEqual(b);
    let norm = 0;
    for (const x of a ?? []) norm += x * x;
    expect(norm).toBeCloseTo(1, 5);
  });

  it('ranks shared-token text above unrelated text', async () => {
    const [query, related, unrelated] = await embedder.embed(
      [
        'local first database search',
        'search the local database quickly',
        'completely different subject entirely',
      ],
      'passage'
    );
    if (!query || !related || !unrelated) throw new Error('missing vectors');
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
