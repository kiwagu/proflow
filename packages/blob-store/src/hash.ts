import { createSHA256 } from 'hash-wasm';

/**
 * SHA-256 of a Blob, streamed: the whole file never has to sit in memory,
 * which is what rules out `crypto.subtle.digest` for video-sized inputs.
 */
export async function hashBlob(
  blob: Blob,
  onProgress?: (done: number) => void
): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const reader = blob.stream().getReader();
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
    seen += value.byteLength;
    onProgress?.(seen);
  }
  return hasher.digest('hex');
}
