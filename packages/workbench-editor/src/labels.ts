import type { DocumentVersion } from '@workspace/domain';
import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import type { NodeTransformType } from '@workspace/lexical-react';
import type { VersionAge } from './history.js';

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

/** Labels for the document outline panel. */
export type OutlineLabels = {
  /** Accessible name for the outline navigation region. */
  nav: string;
};

export const defaultOutlineLabels: OutlineLabels = {
  nav: 'Document outline',
};

/** Labels for the find & replace panel. */
export type FindReplaceLabels = {
  toggle: string;
  findPlaceholder: string;
  replacePlaceholder: string;
  previousMatch: string;
  nextMatch: string;
  close: string;
  replaceOne: string;
  replaceAll: string;
  caseSensitive: string;
  noMatches: string;
  /** "{current} of {total}"; receives the 1-based current match and the total. */
  matchStatus: (current: number, total: number) => string;
};

export const defaultFindReplaceLabels: FindReplaceLabels = {
  toggle: 'Find and replace',
  findPlaceholder: 'Find…',
  replacePlaceholder: 'Replace with…',
  previousMatch: 'Previous match',
  nextMatch: 'Next match',
  close: 'Close',
  replaceOne: 'Replace',
  replaceAll: 'Replace all',
  caseSensitive: 'Match case',
  noMatches: 'No matches',
  matchStatus: (current, total) => `${current} of ${total}`,
};

/** Labels for the document history panel. */
export type HistoryLabels = {
  /** The panel's own heading. */
  title: string;
  /** Accessible name of the panel region and of the control that toggles it. */
  ariaLabel: string;
  /** Shown instead of the list when the document has no marked version yet. */
  empty: string;
  /** The control that returns the document to the previewed version. */
  restore: string;
  /** Why a version's preview is not on screen — the version is unreadable. */
  previewUnavailable: string;
  /** How the version came to be marked, shown as a badge on its row. */
  kind: Record<DocumentVersion['kind'], string>;
  /** How long ago a version was marked, in words. */
  age: (age: VersionAge) => string;
};

export const defaultHistoryLabels: HistoryLabels = {
  title: 'History',
  ariaLabel: 'Document history',
  empty: 'No versions yet. They are marked as you write.',
  restore: 'Restore this version',
  previewUnavailable: 'This version cannot be previewed.',
  kind: {
    manual: 'Saved',
    idle: 'Auto',
    'pre-ai-edit': 'Before assistant',
  },
  age: (age) => {
    switch (age.unit) {
      case 'now':
        return 'Just now';
      case 'minutes':
        return `${age.count} min ago`;
      case 'hours':
        return `${age.count} h ago`;
      case 'days':
        return `${age.count} d ago`;
    }
  },
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

/**
 * Builds the outline panel's labels from the workbench catalog.
 */
export function buildOutlineLabels(t: WorkbenchTranslator): OutlineLabels {
  return {
    nav: t('workbench.editor.outline.nav'),
  };
}

/**
 * Builds the document history panel's labels from the workbench catalog.
 */
export function buildHistoryLabels(t: WorkbenchTranslator): HistoryLabels {
  return {
    title: t('workbench.history.title'),
    ariaLabel: t('workbench.history.ariaLabel'),
    empty: t('workbench.history.empty'),
    restore: t('workbench.history.restore'),
    previewUnavailable: t('workbench.history.previewUnavailable'),
    kind: {
      manual: t('workbench.history.kind.manual'),
      idle: t('workbench.history.kind.idle'),
      'pre-ai-edit': t('workbench.history.kind.preAiEdit'),
    },
    age: (age) => {
      switch (age.unit) {
        case 'now':
          return t('workbench.history.age.now');
        case 'minutes':
          return t('workbench.history.age.minutes', { count: age.count });
        case 'hours':
          return t('workbench.history.age.hours', { count: age.count });
        case 'days':
          return t('workbench.history.age.days', { count: age.count });
      }
    },
  };
}

/**
 * Builds the find & replace panel's labels from the workbench catalog.
 */
export function buildFindReplaceLabels(
  t: WorkbenchTranslator
): FindReplaceLabels {
  return {
    toggle: t('workbench.editor.findReplace.toggle'),
    findPlaceholder: t('workbench.editor.findReplace.findPlaceholder'),
    replacePlaceholder: t('workbench.editor.findReplace.replacePlaceholder'),
    previousMatch: t('workbench.editor.findReplace.previousMatch'),
    nextMatch: t('workbench.editor.findReplace.nextMatch'),
    close: t('workbench.editor.findReplace.close'),
    replaceOne: t('workbench.editor.findReplace.replaceOne'),
    replaceAll: t('workbench.editor.findReplace.replaceAll'),
    caseSensitive: t('workbench.editor.findReplace.caseSensitive'),
    noMatches: t('workbench.editor.findReplace.noMatches'),
    matchStatus: (current, total) =>
      t('workbench.editor.findReplace.matchStatus', { current, total }),
  };
}
