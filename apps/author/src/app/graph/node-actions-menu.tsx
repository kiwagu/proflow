'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  ActionMenu,
  type ActionMenuItem,
} from '@workspace/ui/components/action-menu';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import { PromptDialog } from '@workspace/ui/components/prompt-dialog';
import {
  Check,
  Copy,
  FolderInput,
  FolderPlus,
  Info,
  Pencil,
  Share2,
  SquarePen,
  Target,
  Trash2,
} from 'lucide-react';
import * as React from 'react';

import { allFolders, type Containment } from '@/app/graph/containment';
import { FolderPickerDialog } from '@/app/graph/folder-picker-dialog';
import type { SpaceCapabilities } from '@/app/graph/graph-data.types';
import { ShareDialog } from '@/app/graph/views/resource-panel/share-dialog';

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
  currentUserId,
  ownerUserId,
  capabilities,
  onMutated,
  onActed,
  onDetails,
  onEdit,
  onCopyToClipboard,
  onOpenInKb,
  triggerClassName,
}: {
  spaceId: string;
  t: GraphTranslator;
  node: { id: string; kind: string; title: string };
  containment: Containment;
  /**
   * The viewer's own Supabase id — combined with `ownerUserId` to decide whether the
   * viewer owns THIS node (the owner-sovereign half of the RLS predicate). A display
   * decision only; RLS is the authority.
   */
  currentUserId: string | null;
  /** This node's owner (`knowledge_resources.owner_user_id`). `null` → ownerless. */
  ownerUserId: string | null;
  /**
   * The viewer's space-level knowledge verbs, resolved once server-side. Combined
   * with ownership to DISPLAY-GATE the edit/move/delete/new-subfolder items per the
   * `knowledge_resources` RLS predicate (gating = display, fail-safe). A
   * shared, non-owner viewer without the verbs sees only Copy + Details.
   */
  capabilities: SpaceCapabilities;
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
  /** Reveal this node in the KB containment tree (jump to the 'kb' lens at its parent
   * folder so its position among siblings is visible). Omit to hide the item. */
  onOpenInKb?: (nodeId: string) => void;
  /** Extra classes for the `⋯` trigger (e.g. hover-reveal on a card). */
  triggerClassName?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState('top');
  const [subfolderOpen, setSubfolderOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);

  const folders = React.useMemo(
    () => allFolders(containment).filter((f) => f.id !== node.id),
    [containment, node.id]
  );

  // Display gates — the EXACT `knowledge_resources` RLS predicate, evaluated client-
  // side from the already-resolved inputs (owner-sovereign OR the space verb). NEVER
  // the security boundary: RLS re-checks on every route, so a forged client cannot
  // widen access — hiding only spares a non-owner a silent no-op. There are NO
  // per-node write grants, so the space verb is the whole non-owner capability.
  const owned = ownerUserId != null && ownerUserId === currentUserId;
  const canModify = owned || capabilities.canUpdate;
  const canDelete = owned || capabilities.canDelete;
  // Share = audience management: owner-sovereign OR the space
  // access verb — the EXACT per-user-grant / cohort INSERT-DELETE RLS authority
  // (owner OR `space.knowledge.access`). Laxer-not-stricter: a
  // shown Share the user cannot perform simply no-ops under RLS on the route.
  const canShare = owned || capabilities.canAccess;
  // New-subfolder INSERTs a folder node (needs the create verb) AND wires a `contains`
  // edge; it is offered only on a folder the viewer can modify and create within.
  const canCreate = capabilities.canCreate;
  // Move = DELETE the current `contains` edge + INSERT a new one. The edge DELETE
  // policy is (`created_by = me OR space.knowledge.delete`) and the edge INSERT is
  // (`created_by = me AND space.knowledge.create`) — NOT a single `update` verb. But
  // the ratified item→gate mapping ties Move to `canModify`, and the realistic gated
  // case (a shared NON-owner WITHOUT verbs) is hidden by `canModify` regardless. A
  // node owner who modifies but lacks create/delete could still see a Move that the
  // edge route then no-ops — RLS catches it (fail-safe), so `canModify` is the chosen,
  // safe display tier; see the verb note in refs/git-logs.
  const canMove = canModify;

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
            hidden: !canModify,
            icon: <SquarePen className="size-4" aria-hidden />,
            label: t('graph.reader.edit'),
            onSelect: onEdit,
          } satisfies ActionMenuItem,
        ]
      : []),
    {
      id: 'new-subfolder',
      hidden: node.kind !== 'folder' || !canModify || !canCreate,
      icon: <FolderPlus className="size-4" aria-hidden />,
      label: t('graph.panel.newSubfolder'),
      onSelect: () => setSubfolderOpen(true),
    },
    {
      id: 'rename',
      hidden: !canModify,
      icon: <Pencil className="size-4" aria-hidden />,
      label: t('graph.panel.rename'),
      onSelect: () => setRenameOpen(true),
    },
    {
      id: 'move',
      hidden: !canMove,
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
    {
      id: 'share',
      hidden: !canShare,
      // Groups with Details under one separator (the "share / inspect" section).
      // Details supplies the section break; if Details is omitted (e.g. inside the
      // drawer) Share simply trails Copy — acceptable, never a stray separator.
      icon: <Share2 className="size-4" aria-hidden />,
      label: t('graph.share.menuItem'),
      onSelect: () => setShareOpen(true),
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
    ...(onOpenInKb
      ? [
          {
            id: 'open-in-kb',
            icon: <Target className="size-4" aria-hidden />,
            label: t('graph.panel.openInKb'),
            onSelect: () => onOpenInKb(node.id),
          } satisfies ActionMenuItem,
        ]
      : []),
    {
      id: 'delete',
      hidden: !canDelete,
      separatorBefore: true,
      variant: 'destructive',
      // Delete now routes through the reference-aware Trash flow: a soft,
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

      <ShareDialog
        t={t}
        spaceId={spaceId}
        open={shareOpen}
        onOpenChange={setShareOpen}
        node={{ id: node.id, title: node.title }}
        currentUserId={currentUserId}
        ownerUserId={ownerUserId}
        onMutated={onMutated}
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

      {/* Move — the shared folder picker (the folder list is domain data). */}
      <FolderPickerDialog
        t={t}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        folders={folders}
        title={t('graph.panel.move')}
        submitLabel={t('graph.panel.move')}
        value={moveTarget}
        onValueChange={setMoveTarget}
        onSubmit={onMove}
        busy={busy}
      />
    </>
  );
}
