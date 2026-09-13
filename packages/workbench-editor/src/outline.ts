/**
 * Document outline: extracts the heading tree from a markdown document and
 * tracks which heading is "active" against a scroll position. Pure logic
 * lives here so it is testable without mounting an editor or a DOM; the
 * hook wires it to a live LexicalEditor and the component renders it.
 */
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot, type LexicalEditor } from 'lexical';
import { useEffect, useState } from 'react';

export type OutlineHeading = {
  key: string;
  level: number;
  text: string;
};

/** Below this many headings, an outline is not worth showing. */
export const MIN_OUTLINE_HEADINGS = 3;

export function shouldShowOutline(headingCount: number): boolean {
  return headingCount >= MIN_OUTLINE_HEADINGS;
}

/**
 * Reads the current document's top-level headings, in document order,
 * skipping empty ones. Must run inside an editor state read.
 */
export function readHeadings(): OutlineHeading[] {
  return $getRoot()
    .getChildren()
    .filter($isHeadingNode)
    .map((node) => ({
      key: node.getKey(),
      level: Number(node.getTag().slice(1)),
      text: node.getTextContent().trim(),
    }))
    .filter((heading) => heading.text.length > 0);
}

export function headingsEqual(
  a: readonly OutlineHeading[],
  b: readonly OutlineHeading[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (heading, index) =>
        heading.key === b[index]?.key &&
        heading.level === b[index]?.level &&
        heading.text === b[index]?.text
    )
  );
}

/**
 * Given the top offset of each heading (in the same coordinate space as
 * `activeLine`), returns the index of the heading that should read as
 * "active" — the last heading whose top is at or above the active line, or
 * the first heading if the active line is above all of them.
 */
export function getActiveHeadingIndex(
  headingTops: readonly number[],
  activeLine: number
): number {
  if (headingTops.length === 0) return -1;

  let activeIndex = 0;
  for (const [index, top] of headingTops.entries()) {
    if (top > activeLine) break;
    activeIndex = index;
  }
  return activeIndex;
}

/**
 * Tracks the document's headings live: re-reads them on every editor update
 * and only replaces the array reference when the heading set actually
 * changed (so consumers can rely on referential equality for memoisation).
 */
export function useOutlineHeadings(
  editor: LexicalEditor | undefined
): OutlineHeading[] {
  const [headings, setHeadings] = useState<OutlineHeading[]>([]);

  useEffect(() => {
    const refresh = () => {
      const next = editor ? editor.getEditorState().read(readHeadings) : [];
      setHeadings((current) => (headingsEqual(current, next) ? current : next));
    };

    refresh();
    return editor ? editor.registerUpdateListener(refresh) : undefined;
  }, [editor]);

  return headings;
}
