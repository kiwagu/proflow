import { env, pipeline } from '@huggingface/transformers';
import type { IEmbeddingService } from '@workspace/domain';

/**
 * The server's own embedder.
 *
 * Same model family as the client's (MiniLM, 384 dimensions, q8), running on
 * Node instead of in a browser worker. Nothing REQUIRES the two to match:
 * client vectors and server vectors are never compared, so the two engines
 * are free to pin different models. Matching them is a ranking-parity choice,
 * not an invariant.
 *
 * The model id is stored beside every chunk, and the derive plan treats a
 * change of model as a reason to re-index — so bumping the constant here is
 * the whole upgrade procedure.
 */
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384;
const MODEL_ID = 'minilm-l6-v2-q8';

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

export function createServerEmbedder(): IEmbeddingService {
  // Weights are fetched once into the transformers cache directory and reused
  // by every later run of the service.
  env.allowLocalModels = false;

  let extractorPromise: Promise<FeatureExtractor> | null = null;

  const extractor = (): Promise<FeatureExtractor> => {
    if (!extractorPromise) {
      extractorPromise = pipeline('feature-extraction', MODEL, {
        dtype: 'q8',
      }).then((p) => p as unknown as FeatureExtractor);
      // A failed download must not poison every later call.
      extractorPromise.catch(() => {
        extractorPromise = null;
      });
    }
    return extractorPromise;
  };

  return {
    dimensions: DIMENSIONS,
    modelId: MODEL_ID,
    async embed(texts) {
      if (texts.length === 0) return [];
      const extract = await extractor();
      const output = await extract(texts, { pooling: 'mean', normalize: true });
      return output.tolist().map((row) => Float32Array.from(row));
    },
  };
}
