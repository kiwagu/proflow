import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import { getErrorDescription, MarkdownEditorErrors } from './constants';
import * as environment from './support/environment';

describe('getErrorDescription', () => {
  it('returns hardcoded English descriptions when translator is not provided', () => {
    expect(getErrorDescription(MarkdownEditorErrors.EMPTY_SOURCE)).toBe(
      'No document content could be found.'
    );
    expect(getErrorDescription(MarkdownEditorErrors.JSON_PARSE_ERROR)).toBe(
      'Parse error. Invalid document JSON.'
    );
    expect(
      getErrorDescription(MarkdownEditorErrors.VERSION_MISMATCH_ERROR)
    ).toBe(
      'Refresh the page to edit this document. It may have been updated using a newer version of this app.'
    );
    expect(
      getErrorDescription(MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR)
    ).toBe(
      'This doc has been updated on an incompatible version of staging. If you are seeing this message, please open the document on staging to edit.'
    );
  });

  it('returns native mobile English description when on native mobile platform without translator', () => {
    vi.spyOn(environment, 'isNativeMobilePlatform').mockReturnValue(true);
    expect(
      getErrorDescription(MarkdownEditorErrors.VERSION_MISMATCH_ERROR)
    ).toBe(
      'Close and re-open the app to edit this document. It may have been updated using a newer version of this app.'
    );
    vi.restoreAllMocks();
  });

  it('invokes translator with literal keys when translator is provided', () => {
    const keys: string[] = [];
    const t: WorkbenchTranslator = (key: string) => {
      keys.push(key);
      return `translated:${key}`;
    };

    expect(getErrorDescription(MarkdownEditorErrors.EMPTY_SOURCE, t)).toBe(
      'translated:workbench.editor.load.emptySource'
    );
    expect(getErrorDescription(MarkdownEditorErrors.JSON_PARSE_ERROR, t)).toBe(
      'translated:workbench.editor.load.invalidJson'
    );
    expect(
      getErrorDescription(MarkdownEditorErrors.VERSION_MISMATCH_ERROR, t)
    ).toBe('translated:workbench.editor.load.newerVersionWeb');
    expect(
      getErrorDescription(
        MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR,
        t
      )
    ).toBe('translated:workbench.editor.load.incompatibleVersion');

    expect(keys).toEqual([
      'workbench.editor.load.emptySource',
      'workbench.editor.load.invalidJson',
      'workbench.editor.load.newerVersionWeb',
      'workbench.editor.load.incompatibleVersion',
    ]);
  });

  it('uses mobile catalog key when on native mobile platform with translator', () => {
    vi.spyOn(environment, 'isNativeMobilePlatform').mockReturnValue(true);
    const keys: string[] = [];
    const t: WorkbenchTranslator = (key: string) => {
      keys.push(key);
      return `translated:${key}`;
    };

    expect(
      getErrorDescription(MarkdownEditorErrors.VERSION_MISMATCH_ERROR, t)
    ).toBe('translated:workbench.editor.load.newerVersionApp');

    expect(keys).toEqual(['workbench.editor.load.newerVersionApp']);
    vi.restoreAllMocks();
  });
});
