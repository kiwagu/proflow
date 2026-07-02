'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { DataTable, type ColumnDef } from '@workspace/ui/components/data-table';
import { Hint } from '@workspace/ui/components/hint';
import { cn } from '@workspace/ui/lib/utils';
import {
  ArrowUpRight,
  ChevronRight,
  Folder,
  FolderSymlink,
  Info,
} from 'lucide-react';
import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import { usePaneId, useDriveDragState } from '@/app/graph/drive-dnd';
import type { DriveDragData, DriveDropData } from '@/app/graph/drive-dnd';
import type { NodeMeta } from '@/app/graph/graph-data.types';
import { iconForKind, kindLabel, ownerLabel } from '@/app/graph/presentation';
import { StarButton } from '@/app/graph/views/drive/cards/card-rail';
import type { DriveRow } from '@/app/graph/views/drive/list/drive-row';
import {
  modifiedCell,
  sizeCell,
  typeCell,
} from '@/app/graph/views/drive/list/lens-row-cells';

/**
 * Per-row drag/drop wiring for the LIST/TREE table. Runs INSIDE each table row's own
 * component (`DataTableRow`), so the dnd hooks here are rules-of-hooks safe. A
 * content/folder ROW is a drag source; a FOLDER row is also a drop target (re-parent
 * into it). Shortcut rows (symlinks, not nodes) are inert. The returned `rowProps`
 * (ref + listeners + draggable attrs) and `isDropTarget` flag are spread by the table.
 */
function useDriveRowDnd(row: DriveRow): {
  rowProps?: React.HTMLAttributes<HTMLTableRowElement> & {
    ref?: React.Ref<HTMLTableRowElement>;
  };
  isDropTarget?: boolean;
  isCandidate?: boolean;
} | void {
  const paneId = usePaneId();
  const dragState = useDriveDragState();
  const draggable = row.rowKind !== 'shortcut';
  const isFolder = row.rowKind === 'folder';
  const drag = useDraggable({
    id: `${paneId}:row-node-${row.id}`,
    disabled: !draggable,
    data: {
      type: 'node',
      nodeId: row.node.id,
      title: row.node.title,
      kind: row.node.kind,
    } satisfies DriveDragData,
  });
  const drop = useDroppable({
    id: `${paneId}:row-folder-${row.id}`,
    disabled: !isFolder,
    data: { type: 'folder', folderId: row.node.id } satisfies DriveDropData,
  });
  if (row.rowKind === 'shortcut') {
    return undefined;
  }
  const setRef = (el: HTMLTableRowElement | null) => {
    drag.setNodeRef(el);
    if (isFolder) {
      drop.setNodeRef(el);
    }
  };
  const activeNodeId = (drop.active?.data.current as DriveDragData | undefined)
    ?.nodeId;
  const dropOver = isFolder && drop.isOver && activeNodeId !== row.node.id;
  const candidate =
    isFolder &&
    !!dragState &&
    !dragState.isInvalidTarget(row.node.id) &&
    !drag.isDragging;
  return {
    rowProps: {
      ref: setRef,
      ...(drag.attributes as unknown as React.HTMLAttributes<HTMLTableRowElement>),
      ...(drag.listeners as unknown as React.HTMLAttributes<HTMLTableRowElement>),
      className: cn(drag.isDragging && 'opacity-40'),
    },
    isDropTarget: dropOver && !drag.isDragging,
    isCandidate: candidate,
  };
}

/**
 * LensListTable — the parameterizable LIST layout (ADR-0025): a node-set rendered as a
 * sortable table (the generic {@link DataTable}) instead of cards, with every
 * cross-cutting column assembled from optional flags/slots so EVERY lens — KB browse,
 * the flat filter lenses, and (Phase B) the lexical-search list/tree — renders through
 * the ONE table. Row interaction matches the cards (single → Details, double → open).
 * Columns are domain/i18n here; the generic table base lives in `@workspace/ui`.
 *
 * Optional slots default OFF/identity so the existing Drive call site is byte-identical:
 * `snippet` adds a trailing matched-excerpt column (only search supplies it), and
 * `expansion: 'always'` renders the tree fully-unfolded with no collapse (search's
 * advanced view) instead of the collapsible browse tree.
 */
export function LensListTable({
  rows,
  t,
  metaByItem,
  currentUserId,
  selectedId,
  starredSet,
  onToggleStar,
  recentOpenedAt,
  defaultSorting,
  tree = false,
  expansion = 'collapsible',
  dndEnabled = false,
  sharedBadgeFor,
  sizeOf,
  snippet,
}: {
  rows: DriveRow[];
  t: GraphTranslator;
  metaByItem: Record<string, NodeMeta>;
  currentUserId: string | null;
  selectedId?: string;
  /** Non-null in Recent (`resource_id → ISO last_opened_at`): the 4th column shows
   * "Viewed" from it instead of "Modified" from `updated_at`. */
  recentOpenedAt: Record<string, string> | null;
  /** Initial column sort (Recent → viewed-desc; otherwise name-asc). */
  defaultSorting: { id: string; desc: boolean }[];
  /** The starred set + toggle. OPTIONAL (ADR-0025 §1 `star?`): supplied → a leading star
   * column; OMITTED (default OFF, fail-safe) → no star column at all. The structural
   * lenses pass it; the lexical-search list omits it (a ranked hit list has no star). */
  starredSet?: Set<string>;
  onToggleStar?: (nodeId: string, next: boolean) => void;
  /** Browse tree: folders expand inline (a chevron + depth indent in the name cell,
   * `subRows` drive the children). Off → a flat table. */
  tree?: boolean;
  /** Tree expansion mode. `'collapsible'` (default) = the Drive browse tree (opens
   * collapsed, expands on demand). `'always'` = a fully-unfolded tree with no collapse
   * intent — the search advanced list. Ignored when `tree` is false. */
  expansion?: 'collapsible' | 'always';
  /** Wire rows as drag sources / folder rows as drop targets (move = re-parent).
   * Only in 'kb' browse — flat lenses are read-only digests. */
  dndEnabled?: boolean;
  /** The access-mirror badge for a row's node (ADR-0023 §7a), or null when not shared
   * out — rendered in the name cell so the list mirrors the grid cards. */
  sharedBadgeFor?: (node: LensNode) => React.ReactNode;
  /** The byte size for a row's node (uploaded file/video → its own bytes; folder → the
   * recursive sum of its VISIBLE descendant media; `null` for text/link/tag or a
   * media-less folder → the em-dash cell). OPTIONAL: supplied → a "Size" column with a
   * visible-slice Hint on its header; omitted (default OFF) → no size column, so the
   * search list is unchanged. Resolved by the view off the shared folder-size index. */
  sizeOf?: (node: LensNode) => number | null;
  /** OPTIONAL trailing column slot rendering a per-row excerpt (the search snippet) —
   * a localized header plus a per-row cell renderer. Absent (default) → no snippet
   * column, so non-search lenses are unchanged (only the search config supplies it). */
  snippet?: { header: string; cell: (node: LensNode) => React.ReactNode };
}) {
  const columns = React.useMemo<ColumnDef<DriveRow>[]>(
    () => [
      // Tree only: a HIDDEN rank (folders/shortcuts 0, files 1) pinned as the primary
      // sort, so "folders first" holds at every level regardless of the column sort
      // direction (the visible column becomes the secondary sort). Auto-hidden by the
      // DataTable's `pinnedSort`.
      ...(tree
        ? [
            {
              id: 'group',
              accessorFn: (r: DriveRow) => (r.rowKind === 'item' ? 1 : 0),
              enableSorting: true,
              sortingFn: 'basic' as const,
              header: '',
              cell: () => null,
            },
          ]
        : []),
      // OPTIONAL leading star column (ADR-0025 §1 `star?`) — present only when a starred
      // set + toggle are supplied (the structural lenses); omitted for the search list.
      ...(starredSet && onToggleStar
        ? [
            {
              id: 'star',
              header: '',
              enableSorting: false,
              // Shortcuts are symlinks, not nodes — nothing to star.
              cell: ({ row }: { row: { original: DriveRow } }) =>
                row.original.rowKind === 'shortcut' ? null : (
                  <StarButton
                    alwaysShow
                    starred={starredSet.has(row.original.node.id)}
                    onToggle={() =>
                      onToggleStar(
                        row.original.node.id,
                        !starredSet.has(row.original.node.id)
                      )
                    }
                    label={t(
                      starredSet.has(row.original.node.id)
                        ? 'graph.drive.unstar'
                        : 'graph.drive.star'
                    )}
                  />
                ),
              meta: { cellClassName: 'w-10' },
            } satisfies ColumnDef<DriveRow>,
          ]
        : []),
      {
        id: 'name',
        accessorFn: (r) => r.node.title,
        header: t('graph.table.name'),
        cell: ({ row }) => {
          const r = row.original;
          const Icon =
            r.rowKind === 'folder'
              ? Folder
              : r.rowKind === 'shortcut'
                ? FolderSymlink
                : iconForKind(r.node.kind);
          return (
            <div
              className="flex min-w-0 items-center gap-2.5"
              style={tree ? { paddingLeft: row.depth * 18 } : undefined}
            >
              {tree ? (
                row.getCanExpand() ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      row.getToggleExpandedHandler()();
                    }}
                    className="text-muted-foreground hover:text-foreground -ml-1 h-auto shrink-0 rounded p-0.5 hover:bg-transparent"
                    aria-label={t(
                      row.getIsExpanded()
                        ? 'graph.tree.collapse'
                        : 'graph.tree.expand'
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 transition-transform',
                        row.getIsExpanded() && 'rotate-90'
                      )}
                      aria-hidden
                    />
                  </Button>
                ) : (
                  // Align leaf rows with the chevron of expandable siblings.
                  <span className="size-3.5 shrink-0" aria-hidden />
                )
              ) : null}
              <Icon
                className="text-muted-foreground size-[18px] shrink-0"
                aria-hidden
              />
              <span className="truncate font-medium">{r.node.title}</span>
              {r.rowKind === 'shortcut' ? (
                <ArrowUpRight
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden
                />
              ) : (
                (sharedBadgeFor?.(r.node) ?? null)
              )}
            </div>
          );
        },
        meta: { cellClassName: 'max-w-[460px]' },
      },
      {
        id: 'type',
        accessorFn: (r) => kindLabel(t, r.node.kind),
        header: t('graph.table.type'),
        cell: ({ row }) => typeCell(t, row.original.node.kind),
        meta: { cellClassName: 'w-32' },
      },
      {
        id: 'owner',
        accessorFn: (r) =>
          ownerLabel(t, metaByItem[r.node.id]?.ownerUserId, currentUserId),
        header: t('graph.table.owner'),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
        meta: { cellClassName: 'w-32' },
      },
      // In Recent the timestamp column is "Viewed" (when I last opened it, from the
      // per-user overlay) — the reason the item is here; everywhere else it is
      // "Modified" (the node row's `updated_at`).
      {
        id: recentOpenedAt ? 'viewed' : 'modified',
        accessorFn: (r) =>
          (recentOpenedAt
            ? recentOpenedAt[r.node.id]
            : metaByItem[r.node.id]?.lastModifiedAt) ?? '',
        header: t(
          recentOpenedAt ? 'graph.table.viewed' : 'graph.table.modified'
        ),
        cell: ({ getValue }) =>
          modifiedCell((getValue() as string) || undefined),
        meta: { cellClassName: 'w-32' },
      },
      // OPTIONAL size column (ADR-0026 render) — an uploaded file/video's own bytes or a
      // folder's recursive VISIBLE-descendant sum, humanized via `formatBytes`; text/link/
      // tag + media-less folders show "—". Sortable by the raw byte accessor (nulls → -1
      // so the media-less rows sort last). The header carries a visible-slice Hint (the
      // sum is what YOU can see, not an authoritative total). Present only when `sizeOf`
      // is supplied — the search list omits it.
      ...(sizeOf
        ? [
            {
              id: 'size',
              accessorFn: (r: DriveRow) => sizeOf(r.node) ?? -1,
              sortingFn: 'basic' as const,
              header: () => (
                <span className="inline-flex items-center gap-1">
                  {t('graph.table.size')}
                  <Hint label={t('graph.drive.folderSizeHint')}>
                    <Info
                      className="text-muted-foreground size-3.5"
                      aria-hidden
                    />
                  </Hint>
                </span>
              ),
              cell: ({ row }: { row: { original: DriveRow } }) =>
                sizeCell(t, sizeOf(row.original.node)),
              meta: { cellClassName: 'w-28' },
            } satisfies ColumnDef<DriveRow>,
          ]
        : []),
      // OPTIONAL snippet column (search only) — a trailing matched-excerpt slot. Absent
      // by default, so non-search lenses render the original column set unchanged.
      ...(snippet
        ? [
            {
              id: 'snippet',
              enableSorting: false,
              header: snippet.header,
              cell: ({ row }: { row: { original: DriveRow } }) =>
                snippet.cell(row.original.node),
            },
          ]
        : []),
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.actions ? (
            // Stop the row's open/details from firing when using the ⋯ menu.
            <div
              role="presentation"
              className="flex justify-end"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.actions}
            </div>
          ) : null,
        meta: { cellClassName: 'w-10' },
      },
    ],
    [
      t,
      metaByItem,
      currentUserId,
      starredSet,
      onToggleStar,
      recentOpenedAt,
      tree,
      sharedBadgeFor,
      sizeOf,
      snippet,
    ]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      activeRowId={selectedId}
      defaultSorting={defaultSorting}
      // Browse tree: folders expand inline via `subRows`, and a pinned hidden "group"
      // rank keeps folders above files at EVERY level (direction-stable). Flat lenses
      // pass neither → the flat group-order block applies instead.
      getSubRows={tree ? (r) => r.subRows : undefined}
      // Search's advanced tree opens fully-unfolded (`expansion: 'always'`); the Drive
      // browse tree stays collapsible. No-op when `tree` is false.
      defaultExpanded={tree && expansion === 'always'}
      pinnedSort={tree ? 'group' : undefined}
      // Folders + shortcuts (0) always sort as a block above files (1); the
      // column sort applies within each group, so they never interleave.
      groupOrder={(r) => (r.rowKind === 'item' ? 1 : 0)}
      onRowClick={(r) => r.onDetails()}
      onRowActivate={(r) => r.onOpen()}
      // 'kb' browse only: each row is a drag source, folder rows are drop targets
      // (move = re-parent). `useDriveRowDnd` runs inside each row's own component, so
      // its dnd hooks are rules-of-hooks safe across tree expand/collapse.
      rowDnd={dndEnabled ? useDriveRowDnd : undefined}
    />
  );
}
