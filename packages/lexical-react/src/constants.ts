import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import { isNativeMobilePlatform } from './support/environment';

let layer = 0;

export const MarkdownStackingContext = {
  Base: layer++,
  Highlights: layer++,
  Decorators: layer++,
  Accessories: layer++,
} as const;

export enum MarkdownEditorErrors {
  EMPTY_SOURCE = 'EMPTY_SOURCE',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  VERSION_MISMATCH_ERROR = 'VERSION_MISMATCH_ERROR',
  STAGING_VERSION_MISMATCH_ERROR = 'STAGING_VERSION_MISMATCH_ERROR',
}

const MarkdownEditorErrorDescriptions: Record<
  MarkdownEditorErrors,
  () => string
> = {
  [MarkdownEditorErrors.EMPTY_SOURCE]: () =>
    'No document content could be found.',
  [MarkdownEditorErrors.JSON_PARSE_ERROR]: () =>
    'Parse error. Invalid document JSON.',
  // The native mobile app has no way to refresh a page, so tell those users to
  // relaunch the app instead.
  [MarkdownEditorErrors.VERSION_MISMATCH_ERROR]: () =>
    isNativeMobilePlatform()
      ? 'Close and re-open the app to edit this document. It may have been updated using a newer version of this app.'
      : 'Refresh the page to edit this document. It may have been updated using a newer version of this app.',
  [MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR]: () =>
    'This doc has been updated on an incompatible version of staging. If you are seeing this message, please open the document on staging to edit.',
};

/**
 * The literal `workbench.editor.load.*` catalog keys for each error, so a
 * caller with a loaded `WorkbenchTranslator` gets the localized string
 * instead of the hardcoded English default.
 */
const MarkdownEditorErrorCatalogKeys: Record<
  MarkdownEditorErrors,
  () => string
> = {
  [MarkdownEditorErrors.EMPTY_SOURCE]: () => 'workbench.editor.load.emptySource',
  [MarkdownEditorErrors.JSON_PARSE_ERROR]: () =>
    'workbench.editor.load.invalidJson',
  [MarkdownEditorErrors.VERSION_MISMATCH_ERROR]: () =>
    isNativeMobilePlatform()
      ? 'workbench.editor.load.newerVersionApp'
      : 'workbench.editor.load.newerVersionWeb',
  [MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR]: () =>
    'workbench.editor.load.incompatibleVersion',
};

export const getErrorDescription = (
  errorType: MarkdownEditorErrors,
  t?: WorkbenchTranslator
): string => {
  if (t) return t(MarkdownEditorErrorCatalogKeys[errorType]());
  return MarkdownEditorErrorDescriptions[errorType]();
};
