'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { SearchResultItem } from '@workspace/knowledge-contracts';
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
import * as React from 'react';

import {
  activationForKind,
  iconForKind,
  kindLabel,
} from '@/app/graph/presentation';
import { HighlightedText } from '@/app/graph/views/search/highlight-text';
import { useLexicalSearch } from '@/app/graph/views/search/use-lexical-search';

/**
 * CommandPalette — the SECOND consumer of the lexical-search capability (ADR-0024 §5,
 * slice-12 Phase 3). It is the PROOF that search is a SUBSTRATE capability, not a
 * Drive-bound feature: it reuses the EXACT same path the Drive lens uses — the same
 * `useLexicalSearch` hook → the same `POST /author/graph/search` route → the same
 * `resolveSearchQuery` under the same REUSED RLS transport → the same `SearchResult`
 * shape. NO engine change, NO contract change, NO new route, NO new DB path. Postgres
 * RLS stays the sole access fence; this overlay only changes how the identical rows are
 * PRESENTED (a ⌘K command box vs the Drive grid lens) and reuses the workbench's
 * existing navigation to open a selected hit.
 *
 * Primitive: the shared `cmdk`-backed `CommandDialog` (`@workspace/ui/components/command`)
 * — `cmdk` gives the keyboard up/down/Enter + active-item styling for free. CRITICAL:
 * `shouldFilter={false}` so `cmdk` does NOT re-filter or re-rank our rows — search is
 * SERVER-SIDE (lexical, RLS-fenced, ordered `score DESC, title`), and the rows feed
 * straight into `CommandItem`s in server order. The input is CONTROLLED (its value is the
 * hook's term), so `cmdk`'s own internal value never drives a query.
 */

export type CommandPaletteHandlers = {
  /** Open a `text` node in the reader — the SAME launcher a Drive `text` card uses. */
  onOpenDocument: (nodeId: string) => void;
  /** NAVIGATE INTO a `folder` hit (jump to it in the KB tree) — the SAME `goFolder` a
   * Drive folder card uses. Works for a folder outside the resolved canvas (it sets the
   * location and re-resolves), unlike a reveal that needs the cached containment map. */
  onOpenFolder: (nodeId: string) => void;
  /** Open the shared ResourcePanel / reveal a non-text, non-folder hit — the SAME path a
   * Drive search-lens row uses (carries the row's own renderable meta as the canvas
   * fallback for an out-of-canvas hit). */
  onSelect: (item: {
    id: string;
    kind: string;
    title: string;
    status: string;
    visibility: string;
  }) => void;
};

export function CommandPalette({
  messages,
  spaceId,
  open,
  onOpenChange,
  handlers,
}: {
  messages: Record<string, string>;
  spaceId?: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  handlers: CommandPaletteHandlers;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const [term, setTerm] = React.useState('');

  // The ONE shared lexical-search fetch path — identical hook the Drive lens drives, so
  // for the same term under the same session the palette returns IDENTICAL RLS-fenced
  // rows (the Phase-3 merge gate). The palette only RENDERS them differently.
  const { items, loading, resolved, tooShort, trimmed } = useLexicalSearch(
    spaceId,
    term
  );

  // Reset to a fresh command box each time the palette transitions open (driven from the
  // Dialog's open change, not an effect — so no setState-in-effect cascade).
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (next) {
        setTerm('');
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const commit = React.useCallback(
    (item: SearchResultItem) => {
      onOpenChange(false);
      // Dispatch by the kind's ACTIVATION behaviour (presentation.ts) — NOT a per-kind
      // `if`: a container navigates IN, a document opens the reader, everything else opens
      // the shared Details panel. A new node kind slots into this map with no change here.
      switch (activationForKind(item.kind)) {
        case 'navigate':
          handlers.onOpenFolder(item.id);
          return;
        case 'read':
          handlers.onOpenDocument(item.id);
          return;
        default:
          handlers.onSelect({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: item.status,
            visibility: item.visibility,
          });
          return;
      }
    },
    [handlers, onOpenChange]
  );

  const showEmpty = resolved && !loading && items.length === 0 && !tooShort;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('graph.commandPalette.title')}
      description={t('graph.commandPalette.description')}
      showCloseButton={false}
      // The radix-vega CommandDialog already anchors the box (`top-1/3`), rounds it, and
      // zeroes the padding — pass only a width cap.
      className="max-w-xl"
    >
      {/* radix-vega's CommandDialog renders `children` directly (no inner <Command>), so
          the consumer mounts the Command itself. `shouldFilter={false}` because search is
          SERVER-ranked (RLS-fenced, ordered `score DESC, title`) — cmdk must NOT re-rank.
          The stable `id` keeps cmdk's internal accessibility ids SSR/StrictMode-stable. */}
      <Command
        shouldFilter={false}
        id="command-palette"
        data-testid="command-palette"
      >
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder={t('graph.commandPalette.placeholder')}
          data-testid="command-palette-input"
        />
        <CommandList
          className="max-h-[min(60vh,420px)]"
          data-testid="command-palette-results"
        >
          {tooShort ? (
            <EmptyState className="py-8">
              {t('graph.commandPalette.idle')}
            </EmptyState>
          ) : loading && items.length === 0 ? (
            <EmptyState className="py-8">
              {t('graph.search.searching')}
            </EmptyState>
          ) : null}

          {/* The empty state is driven EXPLICITLY off the resolved server response (the
            input is decoupled from cmdk's filter, so cmdk's own item-count heuristic is
            not the authority here). When mounted there are zero `CommandItem`s, so cmdk's
            `Empty` (which renders on a zero filtered-count) shows it. */}
          {showEmpty ? (
            <CommandEmpty data-testid="command-palette-empty">
              {t('graph.search.noResults', { term: trimmed })}
            </CommandEmpty>
          ) : null}

          {/* Canonical structure: result rows live inside a CommandGroup, whose `p-1`
              gives the gap between the input and the first row (a bare list under
              CommandList sticks the first row to the input). */}
          {items.length > 0 ? (
            <CommandGroup>
              {items.map((item) => {
                const Icon = iconForKind(item.kind);
                return (
                  <CommandItem
                    key={item.id}
                    // cmdk keys an item by its `value`; use the node id so server-distinct
                    // rows never collide and selection maps 1:1.
                    value={item.id}
                    onSelect={() => commit(item)}
                    data-testid="command-palette-result"
                    className="gap-3"
                  >
                    <Icon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        <HighlightedText text={item.title} term={trimmed} />
                      </span>
                      {item.snippet && item.snippet !== item.title ? (
                        <span
                          className="text-muted-foreground line-clamp-1 text-xs"
                          data-testid="command-palette-snippet"
                        >
                          <HighlightedText text={item.snippet} term={trimmed} />
                        </span>
                      ) : null}
                    </span>
                    {/* CommandShortcut (not a bare span) pins the type to the RIGHT
                        edge: its `data-slot="command-shortcut"` hides the CommandItem's
                        trailing invisible CheckIcon (which also carries `ml-auto`), so the
                        type no longer splits the free space with it and float mid-row.
                        `tracking-normal` undoes CommandShortcut's `tracking-widest` (meant
                        for ⌘-keys, not a word like "Document"). */}
                    <CommandShortcut className="shrink-0 tracking-normal">
                      {kindLabel(t, item.kind)}
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
