/**
 * Port: turns text into vectors.
 *
 * The `kind` matters: retrieval models are asymmetric, embedding a QUERY and
 * a PASSAGE differently so that questions land near answers. An adapter that
 * ignores it (a symmetric model, a test double) simply treats both the same.
 */
export interface IEmbeddingService {
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>;
  /** Vector width — the schema's `vector(N)` must agree with it. */
  readonly dimensions: number;
  /**
   * Identifies the model AND its parameters. Stored on every chunk: vectors
   * from different models live in different spaces, so a changed id is what
   * makes stale chunks detectable and re-indexable.
   */
  readonly modelId: string;
}
