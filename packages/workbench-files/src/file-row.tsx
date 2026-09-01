'use client';

import type { FileNode } from '@workspace/domain';
import { Button } from '@workspace/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { cn } from '@workspace/ui/lib/utils';
import {
  ChevronRight,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Package,
  PackageOpen,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FileIcon } from './file-icon.js';
import { categoryOf } from './file-tree.js';

export interface MoveTarget {
  id: string | null;
  name: string;
  depth: number;
}

export interface FileRowProps {
  node: FileNode;
  depth: number;
  active: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onStar: (starred: boolean) => void;
  /**
   * For an archive: whether it has been unpacked. Undefined until the
   * answer is known, so a row never claims "still packed" while looking.
   */
  unpacked?: boolean;
  /** Unpacks the archive; absent when the row is not one. */
  onUnpack?: () => void;
  /** Throws away what unpacking produced, keeping the archive. */
  onDiscardUnpacked?: () => void;
  /** Fired once when the pointer settles on the row — a prefetch hint. */
  onApproach?: () => void;
  /** Folders this node could move into (never itself or its descendants). */
  moveTargets?: MoveTarget[];
  onMove?: (parentId: string | null) => void;
  dropTarget?: boolean;
}

/**
 * One row of the explorer: caret (folders), icon, name, and a menu that
 * appears on hover. Renaming happens in place.
 */
export function FileRow(props: FileRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const startRename = () => {
    setDraft(props.node.name);
    setEditing(true);
  };
  const commit = () => {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== props.node.name) props.onRename(name);
  };

  const isArchive = categoryOf(props.node.mime) === 'archive';

  return (
    <div
      className={cn(
        'group/row relative',
        props.dropTarget && 'rounded-md ring-1 ring-primary/60'
      )}
      data-testid="file-row"
      data-file-id={props.node.id}
      data-file-kind={props.node.kind}
      onMouseEnter={() => props.onApproach?.()}
    >
      <div
        role="button"
        tabIndex={0}
        aria-current={props.active ? 'true' : undefined}
        className={cn(
          'flex h-7 w-full min-w-0 cursor-default items-center gap-2 rounded-md pr-7 text-sm transition-colors hover:bg-muted',
          props.active && 'bg-muted text-foreground'
        )}
        style={{ paddingLeft: `${0.5 + props.depth * 0.9}rem` }}
        onClick={() => props.onOpen()}
        onDoubleClick={startRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onOpen();
          }
        }}
      >
        {props.node.kind === 'folder' ? (
          <ChevronRight
            aria-hidden
            data-testid="file-row-caret"
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform duration-[120ms]',
              props.expanded && 'rotate-90'
            )}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle?.();
            }}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <FileIcon node={props.node} />
        {editing ? (
          <input
            ref={input}
            className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm text-foreground ring-1 ring-primary outline-none"
            value={draft}
            aria-label="File name"
            data-testid="file-rename-input"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-left">
            {props.node.name || 'Untitled'}
          </span>
        )}
        {/* An archive and the package it becomes are two states of one
        file, and which one it is in decides what opening it does: unpack
        first, or run straight away. Saying so in the row answers that
        before the click. */}
        {isArchive ? (
          props.unpacked ? (
            <PackageOpen
              className="size-3.5 shrink-0 text-primary"
              data-testid="archive-unpacked"
              aria-label="Unpacked"
            />
          ) : (
            <Package
              className="size-3.5 shrink-0 text-muted-foreground"
              data-testid="archive-packed"
              aria-label="Not unpacked yet"
            />
          )
        ) : null}
        {props.node.starred ? (
          <Star
            aria-label="Starred"
            className="size-3 shrink-0 text-muted-foreground"
          />
        ) : null}
      </div>
      <div className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="file-menu"
              aria-label="File actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2" onSelect={startRename}>
                <Pencil className="size-4" />
                <span className="text-xs">Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                data-testid="file-star"
                onSelect={() => props.onStar(!props.node.starred)}
              >
                <Star className="size-4" />
                <span className="text-xs">
                  {props.node.starred ? 'Unstar' : 'Star'}
                </span>
              </DropdownMenuItem>
              {isArchive && props.onUnpack ? (
                <DropdownMenuItem
                  className="gap-2"
                  data-testid="file-unpack"
                  disabled={props.unpacked === true}
                  onSelect={() => props.onUnpack?.()}
                >
                  <PackageOpen className="size-4" />
                  <span className="text-xs">
                    {props.unpacked ? 'Unpacked' : 'Unpack'}
                  </span>
                </DropdownMenuItem>
              ) : null}
              {isArchive && props.unpacked && props.onDiscardUnpacked ? (
                <DropdownMenuItem
                  className="gap-2"
                  data-testid="file-discard-unpacked"
                  onSelect={() => props.onDiscardUnpacked?.()}
                >
                  <Package className="size-4" />
                  <span className="text-xs">Delete unpacked files</span>
                </DropdownMenuItem>
              ) : null}
              {props.moveTargets && props.onMove ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    className="gap-2"
                    data-testid="file-move"
                  >
                    <Folder className="size-4" />
                    <span className="flex-1 truncate text-xs">Move to</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuGroup>
                      {props.moveTargets.map((target) => (
                        <DropdownMenuItem
                          key={target.id ?? 'root'}
                          className="gap-2"
                          data-testid="file-move-target"
                          disabled={target.id === props.node.parentId}
                          style={{
                            paddingLeft: `${0.5 + target.depth * 0.75}rem`,
                          }}
                          onSelect={() => props.onMove?.(target.id)}
                        >
                          <Folder className="size-4 text-sky-600 dark:text-sky-400" />
                          <span className="truncate text-xs">
                            {target.name}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuItem
                variant="destructive"
                className="gap-2"
                data-testid="file-delete"
                onSelect={() => props.onDelete()}
              >
                <Trash2 className="size-4" />
                <span className="text-xs">Delete</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** A file still being imported: its name, and how far its bytes are. */
export function PendingRow({
  name,
  progress,
  depth,
}: {
  name: string;
  progress: number;
  depth: number;
}) {
  return (
    <div
      className="relative flex items-center gap-2 rounded-md py-1 pr-2 text-sm text-muted-foreground"
      style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
      data-testid="file-pending"
    >
      <span className="size-3 shrink-0" />
      <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="w-9 text-right text-xs tabular-nums">
        {Math.round(progress * 100)}%
      </span>
      <div className="absolute right-0 bottom-0 left-0 h-px bg-border">
        <div
          className="h-full bg-primary"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
