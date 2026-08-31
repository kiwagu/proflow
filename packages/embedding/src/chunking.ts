/**
 * How a document becomes vectors.
 *
 * Two facts drive the shape. Embedding models of this class read ~512 tokens
 * and their tokenizers TRUNCATE SILENTLY — text past the window contributes
 * nothing, and nothing warns about it. And retrieval quality collapses when
 * a probe matches text that fell outside the embedded prefix.
 *
 * So: one primary window over the head of the text (cheap, matches short
 * documents whole), plus overlapping windows covering the rest, so no part
 * of a long document is invisible to search. The overlap keeps sentences
 * that straddle a boundary findable from either side.
 */
export const WINDOW_CHARS = 1800;
export const OVERLAP_CHARS = 200;
/** Safety valve: pathological documents must not embed forever. */
export const MAX_WINDOWS = 24;

export interface TextWindow {
  text: string;
  charStart: number;
}

export function passageWindows(content: string): TextWindow[] {
  const text = content.trim();
  if (!text) return [];
  const windows: TextWindow[] = [
    { text: text.slice(0, WINDOW_CHARS), charStart: 0 },
  ];
  const step = WINDOW_CHARS - OVERLAP_CHARS;
  for (
    let start = step;
    start < text.length && windows.length < MAX_WINDOWS;
    start += step
  ) {
    windows.push({
      text: text.slice(start, start + WINDOW_CHARS),
      charStart: start,
    });
  }
  return windows;
}
