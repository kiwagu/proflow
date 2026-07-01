'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { CardTile } from '@workspace/ui/components/card-tile';
import { cn } from '@workspace/ui/lib/utils';
import * as React from 'react';

import type { LensNode } from '@/app/graph/containment';
import type { KbAttributes, NodeMeta } from '@/app/graph/graph-data.types';
import {
  formatNodeMeta,
  iconForMedia,
  kindLabel,
  ownerLabel,
} from '@/app/graph/presentation';
import { MediaFacts } from '@/app/graph/views/media-facts';
import type { DriveLayout } from '@/app/graph/views/drive/layout-toggle';
import {
  CardActionRail,
  GRID_CARD,
  useCardOpen,
  type CardDnd,
} from '@/app/graph/views/drive/cards/card-rail';

export function ItemCard({
  t,
  node,
  attributes,
  meta,
  currentUserId,
  layout,
  selected,
  onOpen,
  onDetails,
  star,
  actions,
  footer,
  sharedBadge,
  when,
  dnd,
}: {
  t: GraphTranslator;
  node: LensNode;
  attributes?: KbAttributes;
  meta?: NodeMeta;
  currentUserId: string | null;
  layout: DriveLayout;
  selected: boolean;
  /** Double-click / Open: a document opens its read-view (other kinds: Details). */
  onOpen: () => void;
  /** Single-click: open the shared Details panel for this node. */
  onDetails: () => void;
  /** Per-node star toggle (reveals on hover; solid amber once starred). */
  star?: React.ReactNode;
  /** Hover `⋯` action menu for this node (Details opens the panel). */
  actions?: React.ReactNode;
  /** Extra line under the meta line (the "Shared by me" grantee summary). */
  footer?: React.ReactNode;
  /** The access-mirror people-icon badge, shown when the node is shared out (ADR-0023
   * §7a) — direct OR via a granted ancestor. Rendered inline beside the title. */
  sharedBadge?: React.ReactNode;
  /** The "For you" sort timestamp, appended to the meta line (opened / updated time). */
  when?: string;
  /** Drag wiring (a content card is draggable, but not a drop target). */
  dnd?: CardDnd;
}) {
  const list = layout === 'list';
  const open = useCardOpen(onDetails, onOpen);

  // Meta line (prototype `n.meta || meta.label · owner`): link host / file size /
  // video duration from the REAL `kb` satellites (`resource_media_meta` /
  // `resource_link`). When a satellite row is absent the value is simply null and
  // the line falls back to "{kind} · {owner}" — no mock fill (poc-no-fallbacks).
  const media = {
    byteSize: attributes?.media?.byteSize ?? null,
    durationMs: attributes?.media?.durationMs ?? null,
    mimeType: attributes?.media?.mimeType ?? null,
    linkHost: attributes?.link?.host ?? null,
  };
  const mediaMeta = formatNodeMeta(t, node.kind, media);
  const metaLine =
    mediaMeta ??
    t('graph.drive.metaOwner', {
      kind: kindLabel(t, node.kind),
      owner: ownerLabel(t, meta?.ownerUserId, currentUserId),
    });

  // A file/video with confirmed bytes shows its metadata as a compact key/value
  // block in the (otherwise empty) grid-card body — Type / Size / Filename, all from
  // the `resource_media_meta` satellite. Grid-only (a list row is one line), but shown
  // on EVERY grid lens (KB / Starred / Recent / Shared / Search) so a file's card is
  // identical everywhere; the recency "when" timestamp is appended below the facts, not
  // swapped in. A bodyless stub carries no `media` → the plain meta line renders
  // (poc-no-fallbacks).
  const mediaRows = !list && attributes?.media ? attributes.media : null;

  return (
    <div
      ref={dnd?.setRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      className={cn(
        'group relative select-none',
        list ? 'w-full' : GRID_CARD,
        dnd?.dragging && 'opacity-40'
      )}
    >
      <CardTile
        {...open}
        data-selected={selected}
        className={cn(
          'w-full',
          list
            ? 'gap-3 px-3.5 py-2.5'
            : 'h-44 items-start gap-2.5 overflow-hidden p-4',
          selected ? 'border-ring ring-ring/35 ring-[3px]' : ''
        )}
      >
        {React.createElement(iconForMedia(node.kind, media.mimeType), {
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
              list
                ? 'truncate'
                : mediaRows
                  ? 'line-clamp-2 pr-9'
                  : 'line-clamp-4 pr-9'
            )}
          >
            {node.title}
          </div>
          {mediaRows ? (
            <div className="mt-1.5">
              <MediaFacts t={t} media={mediaRows} />
              {when || sharedBadge ? (
                <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                  {when ? <span className="shrink-0">{when}</span> : null}
                  {sharedBadge}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              <span className="truncate">
                {when ? kindLabel(t, node.kind) : metaLine}
              </span>
              {when ? <span className="shrink-0">· {when}</span> : null}
              {sharedBadge}
            </div>
          )}
          {footer ? <div className="mt-1.5">{footer}</div> : null}
        </div>
      </CardTile>
      <CardActionRail star={star} actions={actions} list={list} />
    </div>
  );
}
