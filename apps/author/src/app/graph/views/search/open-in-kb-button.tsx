'use client';

import { RowActionButton } from '@workspace/ui/components/platform/row-action-button';
import { Target } from 'lucide-react';

/**
 * OpenInKbButton — the per-row "Open in KB" affordance on every search RESULT (a matched
 * hit), shared by all four search view combos (flat grid / flat table / advanced tree
 * grid+list). Jumps to the resource's position in the KB containment tree (the 'kb' lens
 * at its parent folder, node highlighted) — the SAME `revealInKb` the right Details panel
 * + the Drive `⋯` menu use, surfaced directly on the row (most useful in flat, where you
 * see only the leaf, not where it lives).
 *
 * A thin domain wrapper over the shared `RowActionButton` (the single source of truth for
 * the row-action icon-button style — strong hover, stopPropagation, Hint tooltip): this
 * only supplies the `Target` icon (the SAME "reveal/locate in KB" glyph the `NodeActionsMenu`
 * openInKb item uses — NOT `FolderInput`, which is Move) and the testid the e2e/screenshot
 * probe targets. `reveal` controls visibility: 'hover' hover-reveals it (grid-card corner),
 * 'always' keeps it visible (the table action cell, which has no hover group). Only ever
 * rendered on a HIT row.
 */
export function OpenInKbButton({
  label,
  onOpen,
  reveal = 'always',
}: {
  label: string;
  onOpen: () => void;
  reveal?: 'hover' | 'always';
}) {
  return (
    <RowActionButton
      label={label}
      onActivate={onOpen}
      reveal={reveal}
      data-testid="drive-search-open-in-kb"
    >
      <Target className="size-4" aria-hidden />
    </RowActionButton>
  );
}
