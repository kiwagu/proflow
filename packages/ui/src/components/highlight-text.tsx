import * as React from 'react';

/**
 * Client-side snippet highlight for lexical-search consumers. Generic and
 * context-free: it takes a plain `text` and a `term` and wraps each
 * case/accent-insensitive occurrence in `<mark>`, emitting REACT NODES (never
 * `dangerouslySetInnerHTML`, so a snippet can never inject markup — the data layer
 * ships PLAIN text). The fold is a presentation approximation so the term we visually
 * `<mark>` matches the same case/accent-insensitive boundaries a lexical fold uses
 * (so `egerie` highlights inside `Égérie`, `getting` inside `Getting`, Cyrillic
 * folds). It is never a fence.
 */

/**
 * Fold a string by lowercasing and stripping accents. NFD + combining-mark strip
 * mirrors `unaccent(lower(...))` for the Latin + Cyrillic cases search corpora cover.
 */
export function foldForHighlight(value: string): string {
  // U+0300–U+036F = the combining diacritical marks NFD splits accents into; drop them
  // to fold `é→e`, `ё→е`-class (the unaccent(lower(...)) approximation).
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * HighlightedText — render `text` with each case/accent-insensitive occurrence of
 * `term` wrapped in `<mark>`. Matching runs over the folded forms (so accents/case
 * fold) but the ORIGINAL substring is rendered, preserving the snippet's real
 * casing/accents. A term that does not occur renders the text unmarked.
 */
export function HighlightedText({
  text,
  term,
}: {
  text: string;
  term: string;
}): React.ReactElement {
  const trimmed = term.trim();
  if (trimmed.length === 0) {
    return <>{text}</>;
  }
  const foldedTerm = foldForHighlight(trimmed);
  // NFD can change length per char (a precomposed accent → base + combining mark we
  // then strip), so fold per-character and keep a map from FOLDED offset back to the
  // ORIGINAL offset — that lets us slice the original (real casing/accents) at the
  // boundaries we found in the folded string.
  const foldedToOriginal: number[] = [];
  let folded = '';
  for (let i = 0; i < text.length; i += 1) {
    const piece = foldForHighlight(text[i] ?? '');
    for (let j = 0; j < piece.length; j += 1) {
      foldedToOriginal.push(i);
    }
    folded += piece;
  }
  foldedToOriginal.push(text.length); // sentinel for the end boundary

  if (foldedTerm.length === 0 || !folded.includes(foldedTerm)) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0; // offset in the FOLDED string
  let key = 0;
  for (;;) {
    const hit = folded.indexOf(foldedTerm, cursor);
    if (hit === -1) {
      break;
    }
    const origStart = foldedToOriginal[hit] ?? text.length;
    const origEnd = foldedToOriginal[hit + foldedTerm.length] ?? text.length;
    if (origStart > (foldedToOriginal[cursor] ?? 0)) {
      parts.push(text.slice(foldedToOriginal[cursor] ?? 0, origStart));
    }
    parts.push(
      <mark
        key={key}
        className="bg-primary/15 text-foreground rounded-[2px] px-0.5"
      >
        {text.slice(origStart, origEnd)}
      </mark>
    );
    key += 1;
    cursor = hit + foldedTerm.length;
  }
  const tail = foldedToOriginal[cursor] ?? text.length;
  if (tail < text.length) {
    parts.push(text.slice(tail));
  }
  return <>{parts}</>;
}
