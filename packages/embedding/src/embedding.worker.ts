/**
 * The model runs here, off the main thread. Embedding a document is a batch
 * job of seconds; on the UI thread that is seconds of frozen editor.
 *
 * Messages in: { id, texts, kind }. Messages out: { id, vectors } with the
 * buffers transferred, or { id, error }.
 */
import { env, pipeline } from '@huggingface/transformers';

// The model is fetched once and cached by the browser; nothing is bundled.
const MODEL = 'Xenova/all-MiniLM-L6-v2';

env.allowLocalModels = false;

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function extractor(): Promise<FeatureExtractor> {
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
}

type Request = { id: number; texts: string[]; kind: 'query' | 'passage' };

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id, texts } = event.data;
  try {
    const extract = await extractor();
    const output = await extract(texts, { pooling: 'mean', normalize: true });
    const vectors = output.tolist().map((row) => Float32Array.from(row));
    (self as unknown as Worker).postMessage(
      { id, vectors },
      { transfer: vectors.map((v) => v.buffer) }
    );
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String(e) });
  }
});
