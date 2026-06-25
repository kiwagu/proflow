'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  ActionMenu,
  type ActionMenuItem,
} from '@workspace/ui/components/action-menu';
import { Button } from '@workspace/ui/components/button';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Label } from '@workspace/ui/components/label';
import { PromptDialog } from '@workspace/ui/components/prompt-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import {
  Check,
  Copy,
  FolderInput,
  FolderPlus,
  Info,
  Pencil,
  SquarePen,
  Trash2,
} from 'lucide-react';
import * as React from 'react';

import { allFolders, type Containment } from '@/app/graph/containment';

/**
 * NodeActionsMenu — the graph node's `⋯` action set. A thin DOMAIN composition over
 * the generic ui primitives ({@link ActionMenu} + {@link ConfirmDialog} /
 * {@link PromptDialog}): this layer owns the graph specifics — which actions a node
 * kind exposes, the RLS routes each one hits, and the i18n labels — while the menu
 * shell, confirm, and prompt mechanics live in the design system. The Move dialog
 * stays bespoke here (its folder picker is domain data).
 *
 * Quick manipulations are one click from the card / toolbar; the rich detail drawer
 * opens via the `Details` item (`onDetails`). Thin transport — each action
 * POSTs/PATCHes/DELETEs a landed RLS route; RLS is the sole authority. `onMutated`
 * re-resolves; `onActed` lets a host (the drawer) close itself after any action.
 */

async function sendJson(
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST'
): Promise<boolean> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function NodeActionsMenu({
  spaceId,
  t,
  node,
  containment,
  onMutated,
  onActed,
  onDetails,
  onEdit,
  onCopyToClipboard,
  triggerClassName,
}: {
  spaceId: string;
  t: GraphTranslator;
  node: { id: string; kind: string; title: string };
  containment: Containment;
  onMutated: () => void;
  /** Fired after any successful action (e.g. the drawer closes itself). */
  onActed?: () => void;
  /** Open the detail drawer. Omit (e.g. inside the drawer itself) to hide the item. */
  onDetails?: () => void;
  /** Edit the document directly (text nodes). Omit to hide the item. */
  onEdit?: () => void;
  /**
   * MARK this node on the Dolphin-style clipboard (no write) — the workbench then
   * offers a Paste affordance in each pane's toolbar. When omitted (standalone /
   * tests), "Copy" falls back to the legacy immediate duplicate-in-place. */
  onCopyToClipboard?: (nodeId: string, title: string) => void;
  /** Extra classes for the `⋯` trigger (e.g. hover-reveal on a card). */
  triggerClassName?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState('top');
  const [subfolderOpen, setSubfolderOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const folders = React.useMemo(
    () => allFolders(containment).filter((f) => f.id !== node.id),
    [containment, node.id]
  );

  async function run(ok: boolean, close: () => void) {
    setBusy(false);
    close();
    if (ok) {
      onMutated();
      onActed?.();
    }
  }

  async function onRename(title: string) {
    setBusy(true);
    const ok = await sendJson(
      '/author/graph/resources',
      { spaceId, resourceId: node.id, title },
      'PATCH'
    );
    await run(ok, () => setRenameOpen(false));
  }

  // Move = re-parent: drop the current containment edge (single parent), then add
  // a `contains` edge from the chosen folder (unless "top level").
  async function onMove() {
    setBusy(true);
    const currentParent = containment.parentOf.get(node.id);
    let ok = true;
    if (currentParent) {
      ok = await sendJson(
        '/author/graph/edges',
        {
          spaceId,
          fromId: currentParent,
          toId: node.id,
          relationType: 'contains',
        },
        'DELETE'
      );
    }
    if (ok && moveTarget !== 'top') {
      ok = await sendJson('/author/graph/edges', {
        action: 'contain',
        spaceId,
        folderId: moveTarget,
        childId: node.id,
      });
    }
    await run(ok, () => setMoveOpen(false));
  }

  // Copy = MARK the node on the Dolphin clipboard (no write). The workbench then
  // surfaces a Paste affordance in each pane's toolbar, so the source can be pasted
  // into ANY folder (the split-pane's payoff) — multi-paste until a new Copy replaces
  // it. Legacy fallback (no clipboard host wired): deep-duplicate in place as a
  // sibling, "{title} (copy)".
  async function onCopy() {
    if (onCopyToClipboard) {
      onCopyToClipboard(node.id, node.title);
      onActed?.();
      return;
    }
    setBusy(true);
    const ok = await sendJson('/author/graph/copy', {
      spaceId,
      sourceId: node.id,
      targetFolderId: containment.parentOf.get(node.id) ?? null,
      rootTitle: t('graph.panel.copySuffix', { title: node.title }),
    });
    await run(ok, () => undefined);
  }

  async function onCreateSubfolder(title: string) {
    setBusy(true);
    const ok = await sendJson('/author/graph/resources', {
      spaceId,
      kind: 'folder',
      title,
      parentFolder: { parentFolderId: node.id },
    });
    await run(ok, () => setSubfolderOpen(false));
  }

  async function onDelete() {
    setBusy(true);
    const ok = await sendJson(
      '/author/graph/resources',
      { spaceId, resourceId: node.id },
      'DELETE'
    );
    await run(ok, () => setConfirmDelete(false));
  }

  const items: ActionMenuItem[] = [
    ...(onEdit
      ? [
          {
            id: 'edit',
            icon: <SquarePen className="size-4" aria-hidden />,
            label: t('graph.reader.edit'),
            onSelect: onEdit,
          } satisfies ActionMenuItem,
        ]
      : []),
    {
      id: 'new-subfolder',
      hidden: node.kind !== 'folder',
      icon: <FolderPlus className="size-4" aria-hidden />,
      label: t('graph.panel.newSubfolder'),
      onSelect: () => setSubfolderOpen(true),
    },
    {
      id: 'rename',
      icon: <Pencil className="size-4" aria-hidden />,
      label: t('graph.panel.rename'),
      onSelect: () => setRenameOpen(true),
    },
    {
      id: 'move',
      icon: <FolderInput className="size-4" aria-hidden />,
      label: t('graph.panel.move'),
      onSelect: () => {
        setMoveTarget(containment.parentOf.get(node.id) ?? 'top');
        setMoveOpen(true);
      },
    },
    {
      id: 'copy',
      icon: <Copy className="size-4" aria-hidden />,
      label: t('graph.panel.copy'),
      onSelect: onCopy,
    },
    ...(onDetails
      ? [
          {
            id: 'details',
            separatorBefore: true,
            icon: <Info className="size-4" aria-hidden />,
            label: t('graph.panel.details'),
            onSelect: onDetails,
          } satisfies ActionMenuItem,
        ]
      : []),
    {
      id: 'delete',
      separatorBefore: true,
      variant: 'destructive',
      // Delete now routes through the reference-aware Trash flow (ADR-0018): a soft,
      // reversible trash that PRESERVES references (folders, shortcuts, other-folder
      // containment, the Payload body) as dormant rows — so the N→1 reference-severing
      // that disabled `text` delete is gone. Enabled for ALL kinds; the destructive
      // `DELETE` is now a recoverable trash (permanent destruction is the distinct
      // purge path inside the Trash lens).
      icon: <Trash2 className="size-4" aria-hidden />,
      label: t('graph.panel.delete'),
      onSelect: () => setConfirmDelete(true),
    },
  ];

  return (
    <>
      <ActionMenu
        items={items}
        label={t('graph.panel.more')}
        triggerClassName={triggerClassName}
      />

      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('graph.panel.rename')}
        defaultValue={node.title}
        submitLabel={t('graph.panel.save')}
        cancelLabel={t('graph.panel.cancel')}
        onSubmit={onRename}
        busy={busy}
        submitIcon={<Check className="size-4" aria-hidden />}
      />

      <PromptDialog
        open={subfolderOpen}
        onOpenChange={setSubfolderOpen}
        title={t('graph.panel.newSubfolder')}
        placeholder={t('graph.create.namePlaceholder')}
        submitLabel={t('graph.create.submit')}
        cancelLabel={t('graph.panel.cancel')}
        onSubmit={onCreateSubfolder}
        busy={busy}
        submitIcon={<FolderPlus className="size-4" aria-hidden />}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('graph.panel.deleteConfirm')}
        confirmLabel={t('graph.panel.delete')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={onDelete}
        busy={busy}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />

      {/* Move — bespoke: the folder picker is domain data, so it stays here. */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('graph.panel.move')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-target">
              {t('graph.create.parentFolder')}
            </Label>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger id="move-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top">
                  {t('graph.create.topLevel')}
                </SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                {t('graph.panel.cancel')}
              </Button>
            </DialogClose>
            <Button onClick={onMove} disabled={busy}>
              {t('graph.panel.move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
