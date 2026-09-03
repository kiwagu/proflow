'use client';

import type { GraphNode } from '@workspace/persistence-pglite';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@workspace/ui/components/command';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { HighlightedText } from '@workspace/ui/components/highlight-text';
import {
  FileText,
  Folder,
  Link,
  Paperclip,
  PlayCircle,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import {
  commitPaletteSelection,
  useCommandPalette,
  type CommandPaletteHandlers,
} from './use-command-palette.js';

/**
 * The command palette over the LOCAL title index.
 *
 * `shouldFilter={false}` because the rows arrive already ranked by the local
 * query (rank, then title) — cmdk must not re-rank or re-filter them. The
 * input is controlled by the hook's term, so cmdk's own internal value never
 * drives a query.
 */

const KIND_ICON: Record<string, LucideIcon> = {
  folder: Folder,
  text: FileText,
  file: Paperclip,
  video: PlayCircle,
  link: Link,
  tag: Tag,
};

function iconForKind(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? FileText;
}

export type CommandPaletteLabels = {
  title: string;
  description: string;
  placeholder: string;
  /** Shown before the term is long enough to search. */
  idle: string;
  searching: string;
  /** Given the trimmed term, the "nothing matched" line. */
  noResults: (term: string) => string;
  /** The kind shown at the right edge of a row. */
  kindLabel: (kind: string) => string;
};

export function CommandPalette({
  labels,
  handlers,
  state,
}: {
  labels: CommandPaletteLabels;
  handlers: CommandPaletteHandlers;
  /** The palette state — hoisted so the host can also open it from a button. */
  state: ReturnType<typeof useCommandPalette>;
}) {
  const { open, setOpen, term, setTerm, trimmed, items, loading, tooShort } =
    state;

  const commit = (node: GraphNode) => {
    setOpen(false);
    commitPaletteSelection(node, handlers);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={labels.title}
      description={labels.description}
      showCloseButton={false}
      className="max-w-xl"
    >
      <Command
        shouldFilter={false}
        id="command-palette"
        data-testid="command-palette"
      >
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder={labels.placeholder}
          data-testid="command-palette-input"
        />
        <CommandList
          className="max-h-[min(60vh,420px)]"
          data-testid="command-palette-results"
        >
          {tooShort ? (
            <EmptyState className="py-8">{labels.idle}</EmptyState>
          ) : loading && items.length === 0 ? (
            <EmptyState className="py-8">{labels.searching}</EmptyState>
          ) : null}

          {/* Driven off the resolved query rather than cmdk's filtered count:
              the input is decoupled from cmdk's filter, so its heuristic is
              not the authority here. */}
          {state.showEmpty ? (
            <CommandEmpty data-testid="command-palette-empty">
              {labels.noResults(trimmed)}
            </CommandEmpty>
          ) : null}

          {items.length > 0 ? (
            <CommandGroup>
              {items.map((node) => {
                const Icon = iconForKind(node.kind);
                return (
                  <CommandItem
                    key={node.id}
                    // cmdk keys an item by its value; the node id keeps rows
                    // distinct and maps selection 1:1.
                    value={node.id}
                    onSelect={() => commit(node)}
                    data-testid="command-palette-result"
                    className="gap-3"
                  >
                    <Icon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        <HighlightedText text={node.title} term={trimmed} />
                      </span>
                    </span>
                    <CommandShortcut className="shrink-0 tracking-normal">
                      {labels.kindLabel(node.kind)}
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
