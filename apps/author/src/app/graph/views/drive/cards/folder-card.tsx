'use client';

import { CardTile } from '@workspace/ui/components/card-tile';
import { cn } from '@workspace/ui/lib/utils';
import {
  ArrowUpRight,
  Folder,
  FolderSymlink,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';

import type { DriveLayout } from '@/app/graph/views/drive/layout-toggle';
import {
  CardActionRail,
  GRID_CARD,
  useCardOpen,
  type CardDnd,
} from '@/app/graph/views/drive/cards/card-rail';

export function FolderCard({
  title,
  subtitle,
  layout,
  shortcut,
  icon,
  onOpen,
  onDetails,
  star,
  actions,
  footer,
  sharedBadge,
  folderHint,
  select,
  dnd,
}: {
  title: string;
  subtitle: string;
  layout: DriveLayout;
  shortcut?: boolean;
  /** Override the leading glyph. A shortcut passes its TARGET's kind icon so the card
   * telegraphs WHAT it points at (a doc / file / video / link / folder) — the shortcut
   * arrow marks it as a symlink. Absent → the default Folder (or FolderSymlink). */
  icon?: LucideIcon;
  /** Double-click / Open: navigate into the folder (or follow the shortcut). */
  onOpen: () => void;
  /** Single-click: open the shared Details panel for this node. */
  onDetails: () => void;
  /** Per-folder star toggle. Omitted for shortcut cards (a symlink, not a node). */
  star?: React.ReactNode;
  /** Hover `⋯` action menu for THIS folder. Folders navigate on click, so actions
   * need a separate affordance — a deliberate delta from the prototype (which
   * navigated folders with no action surface). Omitted for shortcut cards. */
  actions?: React.ReactNode;
  /** Extra line under the subtitle (the "Shared by me" grantee summary). */
  footer?: React.ReactNode;
  /** The access-mirror people-icon badge, shown when the folder is shared out
   * — direct OR via a granted ancestor. Inline beside the title. */
  sharedBadge?: React.ReactNode;
  /** The "placement = sharing" hint on a folder that confers access —
   * names the audience / floor scope. Rendered under the subtitle. */
  folderHint?: React.ReactNode;
  /** Multi-select checkbox (B2) — the bottom-right corner (clear of the leading icon +
   * the top star/⋯ rail); reveals on hover or while selected. Absent → no checkbox (a
   * lens without bulk selection). */
  select?: React.ReactNode;
  /** Drag (this folder can be moved) + drop (other nodes re-parent into it). */
  dnd?: CardDnd;
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);
  return (
    <div
      ref={dnd?.setRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      className={cn(
        'group relative select-none',
        list ? 'w-full' : GRID_CARD,
        dnd?.dragging && 'opacity-40',
        dnd?.candidate &&
          !dnd?.dropOver &&
          'outline-ring/40 rounded-lg outline-1 outline-offset-1 outline-dashed',
        dnd?.dropOver && 'outline-ring rounded-lg outline-2 outline-offset-1'
      )}
    >
      <CardTile
        {...open}
        className={cn(
          'w-full',
          // INVARIANT: a FIXED, uniform grid-card height across EVERY lens (never grow-to-
          // content, which drifts row-to-row) — sized to fit a 2-line title + meta + a
          // footer/hint and the vertical action rail. List rows keep their own height.
          list
            ? 'gap-3 px-3.5 py-2.5'
            : 'h-44 items-start gap-2.5 overflow-hidden p-4'
        )}
      >
        {React.createElement(icon ?? (shortcut ? FolderSymlink : Folder), {
          className: cn(
            'text-muted-foreground',
            list ? 'size-[18px]' : 'size-[22px]'
          ),
          'aria-hidden': true,
        })}
        <div className="min-w-0 flex-1 text-left">
          <div
            className={cn(
              'text-sm font-medium',
              list ? 'truncate' : 'line-clamp-2 pr-9'
            )}
          >
            {title}
          </div>
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate">{subtitle}</span>
            {sharedBadge}
          </div>
          {folderHint}
          {footer ? <div className="mt-1.5">{footer}</div> : null}
        </div>
        {shortcut ? (
          <ArrowUpRight
            className="text-muted-foreground size-3.5"
            aria-hidden
          />
        ) : null}
      </CardTile>
      {select}
      <CardActionRail star={star} actions={actions} list={list} />
    </div>
  );
}
