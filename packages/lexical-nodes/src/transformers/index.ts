/**
 * @file The three transformer lists.
 *
 * ORDER IS BEHAVIOUR HERE, NOT STYLE. Lexical tries transformers in order and
 * takes the first match, so these constraints are normative:
 *
 *  - internal tags that can contain other tags come before the tags they may
 *    contain;
 *  - the plain markdown image rule comes AFTER the internal image rule, which
 *    it is the fallback for;
 *  - the multiline block-equation rule precedes the block one, which precedes
 *    the inline one;
 *  - the unknown-embed fallback is LAST in every list, so it only ever
 *    catches what nothing else claimed.
 *
 * Reordering these lines changes which form wins on import. Do it
 * deliberately or not at all.
 */
import {
  ELEMENT_TRANSFORMERS,
  HEADING,
  LINK,
  MULTILINE_ELEMENT_TRANSFORMERS,
  QUOTE,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
  type Transformer,
} from '@lexical/markdown';
import { EQUATION_BLOCK, EQUATION_INLINE } from './equation';
import { FILE_LINK, I_FILE } from './file';
import {
  EMPTY_PARAGRAPH,
  I_RESOURCE_MENTION,
  I_RESOURCE_MENTION_BLOCK,
  LINE_BREAK,
  RESOURCE_LINK,
  RESOURCE_LINK_BLOCK,
} from './inline';
import { LIST_TRANSFORMERS } from './lists';
import { I_IMAGE, I_VIDEO, IMAGE_LINK, VIDEO_LINK } from './media';
import { createTableTransformer } from './tables';
import { I_UNKNOWN_EMBED } from './unknownEmbed';

/**
 * Block structure from the official set, minus the lists we wrap.
 *
 * `MULTILINE_ELEMENT_TRANSFORMERS` carries fenced code, which spans lines and
 * therefore must be tried before the single-line element rules — a fence's
 * opening line otherwise reads as an ordinary paragraph.
 */
const BASE_ELEMENTS: Transformer[] = [
  ...MULTILINE_ELEMENT_TRANSFORMERS,
  HEADING,
  QUOTE,
  ...LIST_TRANSFORMERS,
  ...ELEMENT_TRANSFORMERS.filter(
    (transformer): boolean => transformer !== HEADING && transformer !== QUOTE
  ),
];

/**
 * The lossless internal form: what gets persisted and what the agent is shown.
 * Every own node round-trips through its `<x-*>` tag with no data lost.
 *
 * Each list carries its own table transformer, built over the list itself:
 * a cell's contents are converted with the list the table sits in, so the
 * form a caller chose holds inside every cell, nested tables included.
 */
export const INTERNAL_TRANSFORMERS: Transformer[] = [
  createTableTransformer(() => INTERNAL_TRANSFORMERS),
  I_RESOURCE_MENTION_BLOCK,
  I_FILE,
  I_IMAGE,
  I_VIDEO,
  EQUATION_BLOCK,
  // The plain-markdown image rule is the fallback for the internal one and
  // must follow it; it lives in the internal list too, so that importing
  // ordinary markdown into a document produces real image nodes.
  IMAGE_LINK,
  ...BASE_ELEMENTS,
  LINK,
  I_RESOURCE_MENTION,
  EQUATION_INLINE,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
  EMPTY_PARAGRAPH,
  LINE_BREAK,
  I_UNKNOWN_EMBED,
];

/**
 * The portable form: GitHub-flavoured markdown any reader understands.
 * Lossy by design — an own node degrades to a link or an image.
 */
export const EXTERNAL_TRANSFORMERS: Transformer[] = [
  createTableTransformer(() => EXTERNAL_TRANSFORMERS),
  RESOURCE_LINK_BLOCK,
  FILE_LINK,
  IMAGE_LINK,
  VIDEO_LINK,
  EQUATION_BLOCK,
  ...BASE_ELEMENTS,
  // Before the stock LINK rule: a `resource://` link is a mention, and LINK
  // would otherwise claim it as an ordinary link and lose the reference.
  RESOURCE_LINK,
  LINK,
  EQUATION_INLINE,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
  I_UNKNOWN_EMBED,
];

/**
 * Import-anything: both forms, internal first so it wins where both match.
 * Used on paste and on import, never to export.
 */
export const ALL_TRANSFORMERS: Transformer[] = [
  createTableTransformer(() => ALL_TRANSFORMERS),
  I_RESOURCE_MENTION_BLOCK,
  RESOURCE_LINK_BLOCK,
  I_FILE,
  I_IMAGE,
  I_VIDEO,
  FILE_LINK,
  VIDEO_LINK,
  EQUATION_BLOCK,
  IMAGE_LINK,
  ...BASE_ELEMENTS,
  I_RESOURCE_MENTION,
  // Before LINK, for the same reason as in the portable list.
  RESOURCE_LINK,
  LINK,
  EQUATION_INLINE,
  ...TEXT_FORMAT_TRANSFORMERS,
  ...TEXT_MATCH_TRANSFORMERS,
  EMPTY_PARAGRAPH,
  LINE_BREAK,
  I_UNKNOWN_EMBED,
];

export { isConversionOnlyTransformer, wrapXml, xmlMatcher } from './inline';
export { LIST_TRANSFORMERS } from './lists';
