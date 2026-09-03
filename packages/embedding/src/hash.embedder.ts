import type { IEmbeddingService } from '@workspace/domain';

/**
 * A deterministic embedder for tests and for environments that must not
 * download a model.
 *
 * Vectors are derived from token hashes, so they carry NO semantics — two
 * paraphrases land nowhere near each other. What they do preserve is exact
 * and overlapping-token similarity, which is enough to exercise the entire
 * pipeline deterministically: chunking, storage, the HNSW index, the SQL,
 * the ranking. Anything asserting actual semantic similarity needs the real
 * model and knows it.
 */
const DIMENSIONS = 384;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function embedOne(text: string): Float32Array {
  const v = new Float32Array(DIMENSIONS);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const token of tokens) {
    const h = hash(token);
    // spread each token over a few dimensions so cosine behaves smoothly
    v[h % DIMENSIONS] = (v[h % DIMENSIONS] ?? 0) + 1;
    v[(h >> 8) % DIMENSIONS] = (v[(h >> 8) % DIMENSIONS] ?? 0) + 0.5;
    v[(h >> 16) % DIMENSIONS] = (v[(h >> 16) % DIMENSIONS] ?? 0) + 0.25;
  }
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < DIMENSIONS; i++) {
    v[i] = (v[i] ?? 0) / norm;
  }
  return v;
}

export function createHashEmbedder(): IEmbeddingService {
  return {
    dimensions: DIMENSIONS,
    modelId: 'hash-v1',
    async embed(texts) {
      return texts.map(embedOne);
    },
  };
}
