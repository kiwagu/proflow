import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { FileText, FolderTree, ScanSearch, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The four KB render variants (slice-11 Ф3 §1, ADR-0014) — 1:1 with the prototype
 * `app.jsx` switcher. The product is ONE graph; these are four PROJECTIONS over it
 * (Invariant #1), each a view-registry entry keyed by `view_types.key`. The order
 * + icons mirror the prototype exactly (folder-tree / file-text / scan-search /
 * share-2).
 *
 * `live` marks whether the view's component has landed. Phase 5 ships ALL FOUR live
 * — `drive` (default) + `notion` + `lens` + `graph` (the spatial map). The switcher
 * is now complete: every tab renders a real projection over the one graph, no
 * disabled "soon" tabs remain (the final view, ADR-0014).
 */

export type KbVariantId = 'drive' | 'notion' | 'lens' | 'graph';

export type KbVariant = {
  id: KbVariantId;
  /** Lucide icon, prototype-parity (folder-tree / file-text / scan-search / share-2). */
  icon: LucideIcon;
  /** false → tab is disabled with a "soon" tooltip (component not landed yet). */
  live: boolean;
};

/** Default variant on entry — `drive` (prototype start + owner directive Ф3). */
export const DEFAULT_KB_VARIANT: KbVariantId = 'drive';

export const KB_VARIANTS: readonly KbVariant[] = [
  { id: 'drive', icon: FolderTree, live: true },
  { id: 'notion', icon: FileText, live: true },
  { id: 'lens', icon: ScanSearch, live: true },
  { id: 'graph', icon: Share2, live: true },
];

export function kbVariantById(id: string): KbVariant | undefined {
  return KB_VARIANTS.find((variant) => variant.id === id);
}

/** Switcher label via LITERAL keys (no dynamic-key indirection — i18n rule). */
export function kbVariantLabel(t: GraphTranslator, id: KbVariantId): string {
  switch (id) {
    case 'drive':
      return t('graph.variant.drive');
    case 'notion':
      return t('graph.variant.notion');
    case 'lens':
      return t('graph.variant.lens');
    case 'graph':
      return t('graph.variant.graph');
  }
}

/** Explainer-strip note via LITERAL keys (prototype VARIANT_NOTE). */
export function kbVariantNote(t: GraphTranslator, id: KbVariantId): string {
  switch (id) {
    case 'drive':
      return t('graph.variant.driveNote');
    case 'notion':
      return t('graph.variant.notionNote');
    case 'lens':
      return t('graph.variant.lensNote');
    case 'graph':
      return t('graph.variant.graphNote');
  }
}
