import type { IEmbeddingService } from '@workspace/domain';

/**
 * The real embedder: MiniLM (384 dimensions, ~25 MB once, then cached by the
 * browser) running in a dedicated worker.
 *
 * The model is symmetric, so `kind` is accepted and unused — kept in the
 * signature because retrieval models are generally asymmetric and the port
 * must not bake one model's property into every caller.
 */
const DIMENSIONS = 384;
const MODEL_ID = 'minilm-l6-v2-q8';

type Pending = {
  resolve: (vectors: Float32Array[]) => void;
  reject: (error: Error) => void;
};

export function createWorkerEmbedder(): IEmbeddingService {
  const worker = new Worker(new URL('./embedding.worker.ts', import.meta.url), {
    type: 'module',
  });
  const pending = new Map<number, Pending>();
  let nextId = 0;

  worker.addEventListener(
    'message',
    (
      event: MessageEvent<{
        id: number;
        vectors?: Float32Array[];
        error?: string;
      }>
    ) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.vectors) entry.resolve(event.data.vectors);
      else entry.reject(new Error(event.data.error ?? 'embedding failed'));
    }
  );

  return {
    dimensions: DIMENSIONS,
    modelId: MODEL_ID,
    embed(texts, kind) {
      const id = nextId++;
      return new Promise<Float32Array[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, texts, kind });
      });
    },
  };
}
