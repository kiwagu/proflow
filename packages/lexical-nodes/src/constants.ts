/**
 * @file The editor's element vocabulary.
 *
 * The names the toolbar and the block-type menu speak in: one flat list of
 * what a block can be turned into. It is deliberately *not* the node type
 * list — `heading1..3` are one Lexical node with a tag, and the toolbar needs
 * them as three separate choices.
 *
 * Lexical's own update tags are not re-exported here; import them from
 * `lexical` directly.
 */
export const EditorElements = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'quote',
  'code',
  'list-bullet',
  'list-number',
  'list-check',
  'link',
] as const;

/** A block type the editor can produce. */
export type ElementName = (typeof EditorElements)[number];

/** The internal markdown tag prefix for this vocabulary's own nodes. */
export const INTERNAL_TAG_PREFIX = 'x-';
