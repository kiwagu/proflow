import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import type { NodeTransformType } from '@workspace/lexical-react';

/**
 * Labels for the format toolbar. The package is i18n-free by convention —
 * the app resolves its catalog and passes the strings down; the defaults
 * exist so tests and prototypes render something readable. `buildFormatToolsLabels`
 * is the real wiring seam: it reads the literal `workbench.editor.*` catalog
 * keys through a `WorkbenchTranslator`, so an app only has to load the
 * catalog and call it — no separate label shape to maintain.
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

/**
 * Builds the format toolbar's labels from the workbench catalog: literal
 * `workbench.editor.*` keys, looked up through the app's loaded translator.
 */
export function buildFormatToolsLabels(
  t: WorkbenchTranslator
): FormatToolsLabels {
  return {
    undo: t('workbench.editor.undo'),
    redo: t('workbench.editor.redo'),
    bold: t('workbench.editor.bold'),
    italic: t('workbench.editor.italic'),
    underline: t('workbench.editor.underline'),
    strikethrough: t('workbench.editor.strikethrough'),
    code: t('workbench.editor.code'),
    highlight: t('workbench.editor.highlight'),
    link: t('workbench.editor.link'),
    linkUrlPlaceholder: t('workbench.editor.linkUrlPlaceholder'),
    linkApply: t('workbench.editor.linkApply'),
    linkRemove: t('workbench.editor.linkRemove'),
    blockType: t('workbench.editor.blockType'),
    toolbar: t('workbench.editor.toolbar'),
    blocks: {
      paragraph: t('workbench.editor.block.paragraph'),
      heading1: t('workbench.editor.block.heading1'),
      heading2: t('workbench.editor.block.heading2'),
      heading3: t('workbench.editor.block.heading3'),
      quote: t('workbench.editor.block.quote'),
      code: t('workbench.editor.block.code'),
      'list-bullet': t('workbench.editor.block.listBullet'),
      'list-number': t('workbench.editor.block.listNumber'),
      'list-check': t('workbench.editor.block.listCheck'),
    },
  };
}

/**
 * Builds the table-size picker's labels from the workbench catalog.
 */
export function buildTableInsertLabels(
  t: WorkbenchTranslator
): TableInsertLabels {
  return {
    insertTable: t('workbench.editor.table.insert'),
    size: (rows, columns) =>
      t('workbench.editor.table.size', { rows, columns }),
  };
}
