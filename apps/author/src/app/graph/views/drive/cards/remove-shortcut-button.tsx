'use client';

import { RowActionButton } from '@workspace/ui/components/platform/row-action-button';
import { Unlink } from 'lucide-react';

/**
 * RemoveShortcutButton — the per-card "Remove shortcut" affordance on a Drive
 * symlink card (ADR-0015 §3). Deletes ONLY the `shortcut` edge folder→target; the
 * target node and its canonical home are untouched (a symlink, not the file). A thin
 * domain wrapper over the shared `RowActionButton` (the single row-action icon-button
 * style — strong hover, stopPropagation, Hint tooltip), supplying the `Unlink` glyph
 * and the e2e testid. `reveal` controls visibility: 'hover' for the grid-card corner,
 * 'always' for the list action cell (no hover group). Rendered ONLY on a shortcut card.
 */
export function RemoveShortcutButton({
  label,
  onRemove,
  reveal = 'always',
}: {
  label: string;
  onRemove: () => void;
  reveal?: 'hover' | 'always';
}) {
  return (
    <RowActionButton
      label={label}
      onActivate={onRemove}
      reveal={reveal}
      data-testid="drive-remove-shortcut"
    >
      <Unlink className="size-4" aria-hidden />
    </RowActionButton>
  );
}
