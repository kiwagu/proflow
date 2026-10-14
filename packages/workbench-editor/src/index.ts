export { DocumentView, type DocumentViewProps } from './document-view.js';
export {
  FindAndReplace,
  type FindAndReplaceProps,
} from './find-and-replace.js';
export { FIND_HIGHLIGHT_TAG, stripFindHighlights } from './find-replace.js';
export { FormatTools, type FormatToolsProps } from './format-tools.js';
export { HistoryPanel, type HistoryPanelProps } from './history-panel.js';
export { newestFirst, versionAge, type VersionAge } from './history.js';
export { Outline, type OutlineProps } from './outline-panel.js';
export { shouldShowOutline, useOutlineHeadings } from './outline.js';
export { TableInsert, type TableInsertProps } from './table-insert.js';
export {
  BLOCK_OPTIONS,
  buildFindReplaceLabels,
  buildFormatToolsLabels,
  buildHistoryLabels,
  buildOutlineLabels,
  buildTableInsertLabels,
  defaultFindReplaceLabels,
  defaultFormatToolsLabels,
  defaultHistoryLabels,
  defaultOutlineLabels,
  defaultTableInsertLabels,
  type BlockOption,
  type FindReplaceLabels,
  type FormatToolsLabels,
  type HistoryLabels,
  type OutlineLabels,
  type TableInsertLabels,
} from './labels.js';
