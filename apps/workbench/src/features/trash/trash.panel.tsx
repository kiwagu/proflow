import { Button } from '@workspace/ui/components/button';
import { Command, CommandList } from '@workspace/ui/components/command';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import {
  ResultList,
  useDriveBulkActions,
  useDriveData,
  useDriveMutations,
  useTrashLens,
} from '@workspace/workbench-graph';
import { useCallback, useMemo, useState } from 'react';
import { allowed } from '@workspace/knowledge-contracts';
import { useServices, useWriteScope } from '../../composition/app-services';
import { useWorkbenchTranslator } from '../../i18n';

/** Trash is a configuration of the shared result list, not another renderer. */
export function TrashPanel() {
  const { nodes, isEmpty } = useTrashLens();
  const { containment } = useDriveData();
  const mutations = useDriveMutations(containment);
  const { storageMaintenance, reportError, identity } = useServices();
  const scope = useWriteScope();
  const t = useWorkbenchTranslator();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [freed, setFreed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = nodes.find((node) => node.id === selectedId);
  // Offered only where the server would let it through: someone else's node
  // in the trash is theirs to restore or delete for good.
  const mine = { owner_user_id: selected?.ownerUserId ?? null };
  const userId = identity?.userId ?? '';
  const mayRestore = !selected || allowed(scope, 'node.trash', mine, userId);
  const mayPurge = !selected || allowed(scope, 'node.purge', mine, userId);
  const confirmTargetPresent =
    confirmation !== null && nodes.some((node) => node.id === confirmation.id);
  // A live update may remove or restore the target while its modal is open.
  // Never let cmdk's next selection become the newly confirmed delete target.
  if (confirmation && !confirmTargetPresent && !busy) setConfirmation(null);
  const clearSelection = useCallback(() => setSelectedId(null), []);
  // Decorate only successful permanent deletion. Restore and trash never GC.
  const maintained = useMemo(
    () => ({
      ...mutations,
      async purgeNode(id: string) {
        const purged = await mutations.purgeNode(id);
        if (!purged) return false;
        const result = await storageMaintenance.freeUnused();
        if (result.isErr()) reportError(result.error);
        else setFreed(result.value);
        return true;
      },
    }),
    [mutations, storageMaintenance, reportError]
  );
  const actions = useDriveBulkActions({
    mutations: maintained,
    clearSelection,
  });
  const run = async (purge: boolean) => {
    const target = purge
      ? confirmTargetPresent
        ? confirmation
        : null
      : selected;
    if (!target || busy) return;
    setBusy(true);
    setFreed(null);
    try {
      if (purge) await actions.purgeMany([target.id]);
      else await actions.restoreMany([target.id]);
    } catch (error) {
      reportError(String(error));
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  };
  const title = t ? t('workbench.trash.title') : 'Trash';
  const restore = t ? t('workbench.trash.restore') : 'Restore';
  const purge = t ? t('workbench.trash.purge') : 'Delete forever';
  const empty = t ? t('workbench.trash.empty') : 'Trash is empty.';

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3 p-3"
      data-testid="trash-panel"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <Command
        shouldFilter={false}
        value={selectedId ?? ''}
        onValueChange={(id) => {
          if (!busy) setSelectedId(id);
        }}
        className="min-h-0 flex-1"
      >
        <CommandList className="max-h-none">
          <ResultList
            items={nodes}
            rowOf={(node) => node}
            term=""
            labels={{ idle: empty, searching: empty, noResults: () => empty }}
            tooShort={false}
            loading={false}
            showEmpty={isEmpty}
            onPick={(node) => {
              if (!busy) setSelectedId(node.id);
            }}
            testId="trash"
          />
        </CommandList>
      </Command>
      <div className="flex flex-wrap gap-2">
        {mayRestore ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!selected || busy}
            onClick={() => void run(false)}
            data-testid="trash-restore"
          >
            {restore}
          </Button>
        ) : null}
        {mayPurge ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={!selected || busy}
            onClick={() => {
              if (selected)
                setConfirmation({ id: selected.id, title: selected.title });
            }}
            data-testid="trash-purge"
          >
            {purge}
          </Button>
        ) : null}
      </div>
      {freed !== null ? (
        <p
          role="status"
          data-testid="trash-freed"
          className="text-muted-foreground text-sm"
        >
          {t
            ? t('workbench.trash.freed', { bytes: freed })
            : `Freed ${freed} bytes.`}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!busy && !open) setConfirmation(null);
        }}
        title={purge}
        description={
          t
            ? t('workbench.trash.confirm', { title: confirmation?.title ?? '' })
            : `Permanently delete “${confirmation?.title ?? ''}”? Its local data cannot be restored.`
        }
        confirmLabel={purge}
        cancelLabel={t ? t('workbench.trash.cancel') : 'Cancel'}
        destructive
        busy={busy}
        onConfirm={() => void run(true)}
      />
    </section>
  );
}
