'use client';

import type { GraphNode } from '@workspace/persistence-pglite';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
} from '@workspace/ui/components/command';
import { ResultList } from './result-list.js';
import {
  commitPaletteSelection,
  useCommandPalette,
  type CommandPaletteHandlers,
} from './use-command-palette.js';

/**
 * The command palette over the LOCAL title index — one configuration of the
 * shared `ResultList` (the search lens is the other): no snippet, because a
 * title index has nothing to excerpt.
 *
 * `shouldFilter={false}` because the rows arrive already ranked by the local
 * query (rank, then title) — cmdk must not re-rank or re-filter them. The
 * input is controlled by the hook's term, so cmdk's own internal value never
 * drives a query.
 */

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

const rowOf = (node: GraphNode) => ({
  id: node.id,
  kind: node.kind,
  title: node.title,
});

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
          <ResultList
            items={items}
            rowOf={rowOf}
            kindLabel={labels.kindLabel}
            term={trimmed}
            labels={labels}
            tooShort={tooShort}
            loading={loading}
            showEmpty={state.showEmpty}
            onPick={commit}
            testId="command-palette"
          />
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
