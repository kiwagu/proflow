'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { CardTile } from '@workspace/ui/components/card-tile';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import { cn } from '@workspace/ui/lib/utils';
import { RotateCcw, Trash2 } from 'lucide-react';
import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import type { NodeMeta } from '@/app/graph/graph-data.types';
import { iconForKind, kindLabel, ownerLabel } from '@/app/graph/presentation';
import type { DriveLayout } from '@/app/graph/views/drive/layout-toggle';
import { GRID_CARD } from '@/app/graph/views/drive/cards/card-rail';

/**
 * TrashCard — one trashed node in the Trash lens (ADR-0018 §10.7). It is NOT a
 * browsable card: a trashed node has no open / navigate / star / ⋯ menu — only the
 * two lifecycle verbs reached from inside Trash, Restore and Purge.
 *
 * - Restore (`PATCH /author/graph/trash`) clears `deleted_at`; references re-admit
 *   automatically (dormant edges). Owner-sovereign / `delete`-verb gated in the DB.
 * - Purge (`DELETE /author/graph/trash`) is the one-way door — it ALWAYS confirms
 *   first, and when the in-use guard rejects it (living cross-owner references) the
 *   confirm switches to the cooperative "in use" message instead of destroying. The
 *   guard rejection is surfaced gracefully (never thrown).
 */
export function TrashCard({
  t,
  node,
  meta,
  currentUserId,
  layout,
  select,
  onRestore,
  onPurge,
}: {
  t: GraphTranslator;
  node: LensNode;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  /** Multi-select checkbox (B2) for bulk Restore / Delete-forever — rendered inline
   * (always visible) as the leading element. Absent → no bulk selection. */
  select?: React.ReactNode;
  onRestore?: (nodeId: string) => Promise<boolean>;
  onPurge?: (nodeId: string) => Promise<'purged' | 'in-use' | 'error'>;
}) {
  const list = layout === 'list';
  const [busy, setBusy] = React.useState(false);
  const [confirmPurge, setConfirmPurge] = React.useState(false);
  // When the in-use guard rejects a purge, the confirm dialog stays open and shows the
  // cooperative "in use" message instead of the destructive prompt (nothing destroyed).
  const [inUse, setInUse] = React.useState(false);

  const metaLine = t('graph.drive.metaOwner', {
    kind: kindLabel(t, node.kind),
    owner: ownerLabel(t, meta?.ownerUserId, currentUserId),
  });

  const handleRestore = async () => {
    if (!onRestore) {
      return;
    }
    setBusy(true);
    await onRestore(node.id);
    // Success re-resolves (the row leaves Trash); a no-op (unauthorized) just clears
    // busy. Either way no throw.
    setBusy(false);
  };

  const handlePurge = async () => {
    if (!onPurge) {
      return;
    }
    setBusy(true);
    const outcome = await onPurge(node.id);
    setBusy(false);
    if (outcome === 'in-use') {
      // Cooperative rejection — keep the dialog open, swap to the in-use message.
      setInUse(true);
      return;
    }
    // 'purged' re-resolves (row gone); 'error' is a clean no-op — close either way.
    setConfirmPurge(false);
  };

  return (
    <>
      {/* A trashed node is NOT clickable (no open/navigate) — so this is the
          non-interactive CardTile (a plain surface <div>, not the clickable
          <button> path which would nest the Restore/Purge buttons). Same card
          tokens, no hover-to-ring.

          List = one horizontal row [icon][title flex-1][actions]. Grid is a fixed
          264px card: the two TEXT actions + icon would squeeze the flex-1 title to
          ~zero and hide it, so grid STACKS — [icon + title] on top, the actions on
          their own justify-end row beneath — keeping the title fully readable. */}
      <CardTile
        interactive={false}
        className={cn(
          list
            ? 'w-full items-center gap-3 px-3.5 py-2.5'
            : cn(GRID_CARD, 'flex-col gap-2.5 p-4')
        )}
      >
        <div
          className={cn(
            'flex min-w-0 items-center',
            list ? 'flex-1 gap-3' : 'w-full gap-2.5'
          )}
        >
          {select}
          {React.createElement(iconForKind(node.kind), {
            className: cn(
              'text-muted-foreground shrink-0',
              list ? 'size-[18px]' : 'size-[22px]'
            ),
            'aria-hidden': true,
          })}
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-sm font-medium">{node.title}</div>
            <div className="text-muted-foreground truncate text-xs">
              {metaLine}
            </div>
          </div>
        </div>
        <div
          className={cn(
            'flex shrink-0 items-center gap-1',
            list ? '' : 'justify-end'
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRestore}
            disabled={busy || !onRestore}
          >
            <RotateCcw className="size-4" aria-hidden />
            {t('graph.trash.restore')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInUse(false);
              setConfirmPurge(true);
            }}
            disabled={busy || !onPurge}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            {t('graph.trash.purge')}
          </Button>
        </div>
      </CardTile>

      <ConfirmDialog
        open={confirmPurge}
        onOpenChange={(open) => {
          setConfirmPurge(open);
          if (!open) {
            setInUse(false);
          }
        }}
        title={t('graph.trash.purge')}
        description={
          inUse
            ? t('graph.trash.inUse', { title: node.title })
            : t('graph.trash.purgeConfirm', { title: node.title })
        }
        confirmLabel={t('graph.trash.purge')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={handlePurge}
        busy={busy}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />
    </>
  );
}
