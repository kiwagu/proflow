import type { NodeTransformType } from '@workspace/lexical-react';

/**
 * Labels for the format toolbar. The package is i18n-free by convention —
 * the app resolves its catalog and passes the strings down; the defaults
 * exist so tests and prototypes render something readable.
 */
export type FormatToolsLabels = {
  undo: string;
  redo: string;
  bold: string;
  italic: string;
  underline: string;
  strikethrough: string;
  code: string;
  highlight: string;
  link: string;
  linkUrlPlaceholder: string;
  linkApply: string;
  linkRemove: string;
  blockType: string;
  /** Accessible name for the toolbar container itself. */
  toolbar: string;
  blocks: Record<BlockOption, string>;
};

/**
 * The block conversions the toolbar offers. A subset of the node-transform
 * vocabulary: `link` is an inline concern (the link popover), and the code
 * alias pair collapses to the one canonical entry.
 */
export const BLOCK_OPTIONS = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'quote',
  'code',
  'list-bullet',
  'list-number',
  'list-check',
] as const satisfies readonly NodeTransformType[];

export type BlockOption = (typeof BLOCK_OPTIONS)[number];

export const defaultFormatToolsLabels: FormatToolsLabels = {
  undo: 'Undo',
  redo: 'Redo',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  code: 'Inline code',
  highlight: 'Highlight',
  link: 'Link',
  linkUrlPlaceholder: 'https://…',
  linkApply: 'Apply',
  linkRemove: 'Remove link',
  blockType: 'Block type',
  toolbar: 'Formatting',
  blocks: {
    paragraph: 'Text',
    heading1: 'Heading 1',
    heading2: 'Heading 2',
    heading3: 'Heading 3',
    quote: 'Quote',
    code: 'Code block',
    'list-bullet': 'Bulleted list',
    'list-number': 'Numbered list',
    'list-check': 'Checklist',
  },
};

/** Labels for the table-size picker. */
export type TableInsertLabels = {
  insertTable: string;
  /** Accessible name for one size cell; receives rows and columns. */
  size: (rows: number, columns: number) => string;
};

export const defaultTableInsertLabels: TableInsertLabels = {
  insertTable: 'Insert table',
  size: (rows, columns) => `${rows} × ${columns} table`,
};
