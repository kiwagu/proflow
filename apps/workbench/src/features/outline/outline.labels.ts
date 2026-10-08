import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';

/**
 * The outline panel's copy, resolved once by the host — the same shape the
 * chat and history panels use, so the catalog stays the one authority.
 */
export interface OutlinePanelLabels {
  /** The panel's own heading. */
  title: string;
  /** Accessible name of the panel region. */
  ariaLabel: string;
  /** The control that opens and closes the panel. */
  toggle: string;
  /** Shown instead of a heading list when there is nothing to outline. */
  empty: string;
  /** Accessible name of the heading navigation itself. */
  nav: string;
}

export const defaultOutlinePanelLabels: OutlinePanelLabels = {
  title: 'Outline',
  ariaLabel: 'Document outline',
  toggle: 'Outline',
  empty: 'No headings yet. Add headings to navigate the document.',
  nav: 'Document outline',
};

export function buildOutlinePanelLabels(
  t: WorkbenchTranslator
): OutlinePanelLabels {
  return {
    title: t('workbench.outline.title'),
    ariaLabel: t('workbench.outline.ariaLabel'),
    toggle: t('workbench.outline.toggle'),
    empty: t('workbench.outline.empty'),
    nav: t('workbench.editor.outline.nav'),
  };
}
