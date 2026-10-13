'use client';

import type { GraphNode } from '@workspace/persistence-pglite';
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@workspace/ui/components/command';
import { Zap } from 'lucide-react';
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

/**
 * Something the host can DO from the box, beside what it can find. The host
 * declares them — which ones exist is its business (an export needs an open
 * document) — and the palette lists, narrows and dispatches.
 */
export type PaletteCommand = {
  id: string;
  label: string;
  run: () => void;
};

/** The commands the term leaves standing; all of them while it is empty. */
function commandsFor(
  commands: readonly PaletteCommand[],
  term: string
): PaletteCommand[] {
  const needle = term.toLowerCase();
  return commands.filter(
    (command) => needle === '' || command.label.toLowerCase().includes(needle)
  );
}

const rowOf = (node: GraphNode) => ({
  id: node.id,
  kind: node.kind,
  title: node.title,
});

export function CommandPalette({
  labels,
  handlers,
  state,
  commands = [],
}: {
  labels: CommandPaletteLabels;
  handlers: CommandPaletteHandlers;
  /** The palette state — hoisted so the host can also open it from a button. */
  state: ReturnType<typeof useCommandPalette>;
  /** What the host offers to do from here, on top of what it can find. */
  commands?: readonly PaletteCommand[];
}) {
  const { open, setOpen, term, setTerm, trimmed, items, loading, tooShort } =
    state;

  const commit = (node: GraphNode) => {
    setOpen(false);
    commitPaletteSelection(node, handlers);
  };
  const runCommand = (command: PaletteCommand) => {
    setOpen(false);
    command.run();
  };
  const visibleCommands = commandsFor(commands, trimmed);

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
          {visibleCommands.length > 0 ? (
            <CommandGroup>
              {visibleCommands.map((command) => (
                <CommandItem
                  key={command.id}
                  // Namespaced: cmdk keys items by value, and a command must
                  // never collide with a node id below it.
                  value={`command:${command.id}`}
                  onSelect={() => runCommand(command)}
                  data-testid="command-palette-command"
                  className="gap-3"
                >
                  <Zap
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                  <span className="truncate text-sm font-medium">
                    {command.label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
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
