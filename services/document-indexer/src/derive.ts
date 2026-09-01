import type { IEmbeddingService } from '@workspace/domain';
import { passageWindows } from '@workspace/embedding';

import { foldDocument, titleFromMarkdown, treeToMarkdown } from './document-text.js';

/**
 * The derive pass: canonical bytes in, one document's index rows out.
 *
 * Split from every transport so it can be exercised whole in a test with
 * hand-built CRDT bytes and a deterministic embedder — no database, no model
 * download.
 */

/** One chunk row, in the shape the write RPC accepts. */
export interface ChunkRow {
  ord: number;
  char_start: number;
  text: string;
  /** pgvector reads vectors as their text literal. */
  embedding: string;
  /** The RPC takes the batch as one jsonb argument. */
  [key: string]: string | number;
}

export interface DerivedDocument {
  title: string;
  chunks: ChunkRow[];
}

/** pgvector reads vectors as their text literal. */
export const toVectorLiteral = (v: Float32Array): string =>
  `[${Array.from(v).join(',')}]`;

/**
 * Derives one document's chunk rows from its stored bytes.
 *
 * Uses the SAME windowing as the client (imported, not re-declared): one
 * chunking, two consumers. Two indexes that disagreed about where a document
 * is cut would rank differently for reasons no one could see.
 *
 * A document that folds to nothing yields no chunks and an empty title. That
 * is a complete, valid result — the caller still advances the watermark, so
 * an empty document is not re-derived on every pass.
 */
export async function deriveDocument(
  bytes: { snapshot?: Uint8Array | null; updates?: Uint8Array[] },
  embedder: IEmbeddingService
): Promise<DerivedDocument> {
  const markdown = treeToMarkdown(foldDocument(bytes));
  const title = titleFromMarkdown(markdown);
  const windows = passageWindows(markdown);
  if (windows.length === 0) return { title, chunks: [] };

  const vectors = await embedder.embed(
    windows.map((w) => w.text),
    'passage'
  );

  const chunks = windows.flatMap((window, i) => {
    const vector = vectors[i];
    return vector
      ? [
          {
            ord: i,
            char_start: window.charStart,
            text: window.text,
            embedding: toVectorLiteral(vector),
          },
        ]
      : [];
  });

  return { title, chunks };
}
