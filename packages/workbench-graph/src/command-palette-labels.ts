import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import type { CommandPaletteLabels } from './command-palette.js';

/**
 * The command palette is catalog-free by convention (see `CommandPalette`) —
 * the app resolves its catalog and passes the strings down. This is the real
 * wiring seam: it reads the literal `workbench.palette.*` catalog keys
 * through a `WorkbenchTranslator`.
 */
export const defaultCommandPaletteLabels: CommandPaletteLabels = {
  title: 'Search the knowledge base',
  description: 'Find a resource by title and open it.',
  placeholder: 'Search resources…',
  idle: 'Type at least 2 characters to search.',
  searching: 'Searching…',
  noResults: (term) => `No results for “${term}”.`,
  kindLabel: (kind) => KIND_LABEL[kind] ?? kind,
};

const KIND_LABEL: Record<string, string> = {
  folder: 'Folder',
  text: 'Document',
  file: 'File',
  video: 'Video',
  link: 'Link',
  tag: 'Tag',
};

/**
 * Builds the command palette's labels from the workbench catalog: literal
 * `workbench.palette.*` keys, looked up through the app's loaded translator.
 */
export function buildCommandPaletteLabels(
  t: WorkbenchTranslator
): CommandPaletteLabels {
  const kindLabels: Record<string, string> = {
    folder: t('workbench.palette.kind.folder'),
    text: t('workbench.palette.kind.text'),
    file: t('workbench.palette.kind.file'),
    video: t('workbench.palette.kind.video'),
    link: t('workbench.palette.kind.link'),
    tag: t('workbench.palette.kind.tag'),
  };
  return {
    title: t('workbench.palette.title'),
    description: t('workbench.palette.description'),
    placeholder: t('workbench.palette.placeholder'),
    idle: t('workbench.palette.idle'),
    searching: t('workbench.palette.searching'),
    noResults: (term) => t('workbench.palette.noResults', { term }),
    kindLabel: (kind) => kindLabels[kind] ?? kind,
  };
}
