/**
 * @file Two list behaviours the stock transformers do not have.
 *
 * The official list transformers are used as-is for everything else; this
 * file only wraps their `replace` to add behaviour observed to matter in
 * practice.
 */
import {
  CHECK_LIST,
  type ElementTransformer,
  ORDERED_LIST,
  UNORDERED_LIST,
} from '@lexical/markdown';
import { $isListNode, ListNode } from '@lexical/list';
import { $isHeadingNode } from '@lexical/rich-text';
import type { ElementNode } from 'lexical';

/**
 * Decline the conversion when the line is a heading.
 *
 * Typing `1. ` at the start of a heading means the author is writing a
 * heading that begins with a number, not asking for the heading to become a
 * list item. Converting there destroys the heading and is always a surprise.
 */
function guardHeading(transformer: ElementTransformer): ElementTransformer {
  return {
    ...transformer,
    replace: (parentNode, children, match, isImport) => {
      if ($isHeadingNode(parentNode)) return;
      transformer.replace(parentNode, children, match, isImport);
    },
  };
}

/** The number the author typed, when the marker carries one. */
function typedStart(match: string[]): number | null {
  for (const group of match.slice(1)) {
    const parsed = Number.parseInt(group ?? '', 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Continue an adjacent ordered list's numbering.
 *
 * Typing `5. ` directly above an existing ordered list means "this list now
 * starts at 5", not "start a second list at 1 next to a list numbered from
 * 1". Without this, splitting a list renumbers the tail from the top.
 */
function continueNumbering(
  transformer: ElementTransformer
): ElementTransformer {
  return {
    ...transformer,
    replace: (parentNode, children, match, isImport) => {
      if ($isHeadingNode(parentNode)) return;
      const start = typedStart(match);
      const nextSibling: ElementNode | null =
        parentNode.getNextSibling() as ElementNode | null;
      transformer.replace(parentNode, children, match, isImport);
      if (
        start !== null &&
        nextSibling !== null &&
        $isListNode(nextSibling) &&
        nextSibling.getListType() === 'number'
      ) {
        (nextSibling as ListNode).setStart(start);
      }
    },
  };
}

export const UNORDERED_LIST_GUARDED = guardHeading(UNORDERED_LIST);
export const CHECK_LIST_GUARDED = guardHeading(CHECK_LIST);
export const ORDERED_LIST_GUARDED = continueNumbering(ORDERED_LIST);

/** The list transformers this vocabulary registers, in order. */
export const LIST_TRANSFORMERS: ElementTransformer[] = [
  CHECK_LIST_GUARDED,
  ORDERED_LIST_GUARDED,
  UNORDERED_LIST_GUARDED,
];
