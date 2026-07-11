'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import { Separator } from '@workspace/ui/components/separator';
import { cn } from '@workspace/ui/lib/utils';
import { FolderInput, RotateCcw, Star, StarOff, Trash2, X } from 'lucide-react';
import * as React from 'react';

import type { Containment } from '../containment';
import { FolderPickerDialog } from '../folder-picker-dialog';
import type {
  DriveMultiSelect,
  DriveScope,
} from '../views/registry/projection-view.types';
import { useDriveBulkActions } from './use-drive-bulk-actions';

/**
 * DriveBulkActions — the floating bulk action bar + its dialogs (release-hardening B2).
 * ONE bar whose ACTION SET is chosen by lens (lens-feature-component-reuse, mirroring the
 * unified LensToolbar): CONTENT lenses expose Trash / Star / Unstar / Move-to-folder;
 * the TRASH lens exposes Restore / Delete-forever. It also hosts the Empty Trash confirm
 * (the toolbar button in the view triggers it via `emptyTrashOpen`).
 *
 * Every verb fans out over the existing per-id routes (or the batch purge endpoint) via
 * {@link useDriveBulkActions}, with an HONEST "N done, M skipped" summary and a re-resolve
 * + selection clear on completion. Purge (bulk Delete-forever AND Empty Trash) is
 * irreversible, so it ALWAYS confirms first (@workspace/ui ConfirmDialog).
 *
 * The bar floats bottom-center OVER the canvas (its `absolute` parent is the workbench
 * content column). It renders while a selection exists (the actions) OR while a summary
 * is pending (the honest result, auto-dismissed).
 */
export function DriveBulkActions({
  t,
  scope,
  spaceId,
  multiSelect,
  containment,
  folders,
  refresh,
  emptyTrashIds,
  emptyTrashOpen,
  onEmptyTrashOpenChange,
}: {
  t: GraphTranslator;
  scope: DriveScope;
  spaceId: string | undefined;
  multiSelect: DriveMultiSelect;
  containment: Containment;
  /** The destination folders for the bulk Move picker (RLS-resolved by the workbench). */
  folders: { id: string; title: string }[];
  refresh: () => void;
  /** ALL trashed ids (for Empty Trash — enumerated from the resolved trash set). */
  emptyTrashIds: string[];
  emptyTrashOpen: boolean;
  onEmptyTrashOpenChange: (open: boolean) => void;
}) {
  const bulk = useDriveBulkActions({
    spaceId,
    containment,
    refresh,
    clearSelection: multiSelect.clear,
  });

  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState('top');
  const [purgeSelectionOpen, setPurgeSelectionOpen] = React.useState(false);

  const selectedIds = React.useMemo(
    () => [...multiSelect.selectedIds],
    [multiSelect.selectedIds]
  );
  const count = multiSelect.count;
  const isTrash = scope === 'trash';

  // Auto-dismiss the transient summary a few seconds after it lands (a new selection
  // also supersedes it — see the render guard). A timeout, not a setState-in-render.
  React.useEffect(() => {
    if (bulk.summary == null) {
      return;
    }
    const timer = setTimeout(() => bulk.dismissSummary(), 6000);
    return () => clearTimeout(timer);
  }, [bulk.summary, bulk]);

  // The bar shows while acting on a selection OR while a summary is pending (with no live
  // selection or progress). Never in the search lens (no checkboxes / selection).
  // Running takes precedence (a bare "Working…" chip, no buttons); then a live selection
  // (the actions); then a lingering summary (the honest result, auto-dismissed).
  const visible = count > 0 || bulk.summary != null || bulk.running;
  const showSummary = !bulk.running && count === 0 && bulk.summary != null;
  if (scope === 'search' || !visible) {
    return (
      <PurgeDialogs
        t={t}
        emptyTrashIds={emptyTrashIds}
        emptyTrashOpen={emptyTrashOpen}
        onEmptyTrashOpenChange={onEmptyTrashOpenChange}
        purgeSelectionOpen={false}
        setPurgeSelectionOpen={setPurgeSelectionOpen}
        selectedIds={selectedIds}
        busy={bulk.running}
        onPurge={bulk.purgeMany}
      />
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
        <div className="bg-popover text-popover-foreground pointer-events-auto flex items-center gap-1.5 rounded-lg border py-2 pr-2 pl-3 shadow-lg">
          {bulk.running ? (
            <span className="px-1 text-sm font-medium">
              {t('graph.bulk.working')}
            </span>
          ) : showSummary ? (
            <>
              <span className="px-1 text-sm">
                {bulk.summary!.skipped === 0
                  ? t('graph.bulk.summaryDone', { count: bulk.summary!.done })
                  : t('graph.bulk.summarySkipped', {
                      done: bulk.summary!.done,
                      skipped: bulk.summary!.skipped,
                    })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={bulk.dismissSummary}
                aria-label={t('graph.bulk.clearSelection')}
                className="size-7 p-0"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <span className="px-1 text-sm font-medium tabular-nums">
                {t('graph.bulk.selectedCount', { count })}
              </span>
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              {isTrash ? (
                <>
                  <BulkButton
                    icon={RotateCcw}
                    label={t('graph.trash.restore')}
                    disabled={bulk.running}
                    onClick={() => void bulk.restoreMany(selectedIds)}
                  />
                  <BulkButton
                    icon={Trash2}
                    label={t('graph.trash.purge')}
                    destructive
                    disabled={bulk.running}
                    onClick={() => setPurgeSelectionOpen(true)}
                  />
                </>
              ) : (
                <>
                  <BulkButton
                    icon={Star}
                    label={t('graph.drive.star')}
                    disabled={bulk.running}
                    onClick={() => void bulk.starMany(selectedIds, true)}
                  />
                  <BulkButton
                    icon={StarOff}
                    label={t('graph.drive.unstar')}
                    disabled={bulk.running}
                    onClick={() => void bulk.starMany(selectedIds, false)}
                  />
                  <BulkButton
                    icon={FolderInput}
                    label={t('graph.panel.move')}
                    disabled={bulk.running}
                    onClick={() => {
                      setMoveTarget('top');
                      setMoveOpen(true);
                    }}
                  />
                  <BulkButton
                    icon={Trash2}
                    label={t('graph.panel.delete')}
                    destructive
                    disabled={bulk.running}
                    onClick={() => void bulk.trashMany(selectedIds)}
                  />
                </>
              )}
              <Separator orientation="vertical" className="mx-0.5 h-6" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={multiSelect.clear}
                disabled={bulk.running}
                aria-label={t('graph.bulk.clearSelection')}
                className="size-7 p-0"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>

      <FolderPickerDialog
        t={t}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        folders={folders}
        title={t('graph.panel.move')}
        submitLabel={t('graph.panel.move')}
        value={moveTarget}
        onValueChange={setMoveTarget}
        busy={bulk.running}
        onSubmit={() => {
          setMoveOpen(false);
          void bulk.moveMany(selectedIds, moveTarget);
        }}
      />

      <PurgeDialogs
        t={t}
        emptyTrashIds={emptyTrashIds}
        emptyTrashOpen={emptyTrashOpen}
        onEmptyTrashOpenChange={onEmptyTrashOpenChange}
        purgeSelectionOpen={purgeSelectionOpen}
        setPurgeSelectionOpen={setPurgeSelectionOpen}
        selectedIds={selectedIds}
        busy={bulk.running}
        onPurge={bulk.purgeMany}
      />
    </>
  );
}

/** One bulk-bar action button — icon + label, ghost, destructive-tinted for purge/trash. */
function BulkButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn(destructive && 'text-destructive hover:text-destructive')}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

/**
 * The two irreversible-purge confirms — Empty Trash (all trashed ids) and bulk Delete-
 * forever (the selection). Both page through the batch endpoint via `onPurge`. Rendered
 * always (even with the bar hidden) so the Empty Trash toolbar button can open its
 * confirm regardless of whether anything is selected.
 */
function PurgeDialogs({
  t,
  emptyTrashIds,
  emptyTrashOpen,
  onEmptyTrashOpenChange,
  purgeSelectionOpen,
  setPurgeSelectionOpen,
  selectedIds,
  busy,
  onPurge,
}: {
  t: GraphTranslator;
  emptyTrashIds: string[];
  emptyTrashOpen: boolean;
  onEmptyTrashOpenChange: (open: boolean) => void;
  purgeSelectionOpen: boolean;
  setPurgeSelectionOpen: (open: boolean) => void;
  selectedIds: string[];
  busy: boolean;
  onPurge: (ids: string[]) => void | Promise<void>;
}) {
  return (
    <>
      <ConfirmDialog
        open={emptyTrashOpen}
        onOpenChange={onEmptyTrashOpenChange}
        title={t('graph.trash.emptyTrash')}
        description={t('graph.trash.emptyTrashConfirm', {
          count: emptyTrashIds.length,
        })}
        confirmLabel={t('graph.trash.emptyTrash')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={() => {
          onEmptyTrashOpenChange(false);
          void onPurge(emptyTrashIds);
        }}
        busy={busy}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />

      <ConfirmDialog
        open={purgeSelectionOpen}
        onOpenChange={setPurgeSelectionOpen}
        title={t('graph.trash.purge')}
        description={t('graph.bulk.purgeConfirm', {
          count: selectedIds.length,
        })}
        confirmLabel={t('graph.trash.purge')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={() => {
          setPurgeSelectionOpen(false);
          void onPurge(selectedIds);
        }}
        busy={busy}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />
    </>
  );
}
