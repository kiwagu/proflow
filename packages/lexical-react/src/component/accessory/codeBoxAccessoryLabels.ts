import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';

/**
 * Labels for the code box accessory (copy/delete actions, the preview
 * toggle caption, and the SVG preview's empty/invalid states). This package
 * is i18n-free by convention — the app resolves its catalog and passes the
 * strings down; the defaults exist so tests and prototypes render something
 * readable. `buildCodeBoxAccessoryLabels` is the real wiring seam: it reads
 * the literal `workbench.editor.codeBox.*` catalog keys through a
 * `WorkbenchTranslator`, so an app only has to load the catalog and call it.
 */
export type CodeBoxAccessoryLabels = {
  copyCode: string;
  deleteCode: string;
  preview: string;
  svgEmpty: string;
  svgInvalid: string;
};

export const defaultCodeBoxAccessoryLabels: CodeBoxAccessoryLabels = {
  copyCode: 'Copy Code',
  deleteCode: 'Delete Code',
  preview: 'Preview',
  svgEmpty: 'No SVG content',
  svgInvalid: 'Invalid SVG content',
};

/**
 * Builds the code box accessory's labels from the workbench catalog:
 * literal `workbench.editor.codeBox.*` keys, looked up through the app's
 * loaded translator.
 */
export function buildCodeBoxAccessoryLabels(
  t: WorkbenchTranslator
): CodeBoxAccessoryLabels {
  return {
    copyCode: t('workbench.editor.codeBox.copy'),
    deleteCode: t('workbench.editor.codeBox.delete'),
    preview: t('workbench.editor.codeBox.preview'),
    svgEmpty: t('workbench.editor.codeBox.svgEmpty'),
    svgInvalid: t('workbench.editor.codeBox.svgInvalid'),
  };
}
