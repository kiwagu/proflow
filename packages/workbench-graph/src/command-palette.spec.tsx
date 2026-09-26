import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandPalette,
  type CommandPaletteLabels,
  type PaletteCommand,
} from './command-palette.js';
import { GraphServicesProvider } from './graph-services.js';
import { closeTestGraph, openTestGraph, type TestGraph } from './testing.js';
import {
  type CommandPaletteHandlers,
  useCommandPalette,
} from './use-command-palette.js';

/**
 * Commands in the palette: what the host can DO from the box, beside what it
 * can find. They are the host's to declare — the palette only lists, narrows
 * and dispatches them — so a document-level action lives with the surface
 * that owns the document, not in this package.
 */

const labels: CommandPaletteLabels = {
  title: 'Search',
  description: 'Find or do',
  placeholder: 'Type…',
  idle: 'Keep typing',
  searching: 'Searching…',
  noResults: (term) => `Nothing for ${term}`,
  kindLabel: (kind) => kind,
};
const handlers: CommandPaletteHandlers = {
  onOpenFolder: () => {},
  onOpenDocument: () => {},
  onInspect: () => {},
};

let graph: TestGraph | null = null;

afterEach(async () => {
  await closeTestGraph(graph);
  graph = null;
});

function Host({ commands }: { commands: readonly PaletteCommand[] }) {
  const state = useCommandPalette();
  return (
    <>
      <button data-testid="open" onClick={() => state.setOpen(true)} />
      <CommandPalette
        labels={labels}
        handlers={handlers}
        state={state}
        commands={commands}
      />
    </>
  );
}

function mount(open: TestGraph, commands: readonly PaletteCommand[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GraphServicesProvider services={open.services}>
      {children}
    </GraphServicesProvider>
  );
  return render(<Host commands={commands} />, { wrapper });
}

const typeTerm = (term: string) =>
  fireEvent.change(screen.getByTestId('command-palette-input'), {
    target: { value: term },
  });

describe('commands in the palette', () => {
  it('lists the host commands before anything is typed and runs the picked one', async () => {
    graph = await openTestGraph();
    const run = vi.fn();
    mount(graph, [{ id: 'export', label: 'Export as Markdown', run }]);

    act(() => screen.getByTestId('open').click());
    const command = await screen.findByTestId('command-palette-command');
    expect(command.textContent).toContain('Export as Markdown');

    act(() => command.click());
    expect(run).toHaveBeenCalledTimes(1);
    // Picking a command dismisses the box, like picking a result does.
    await waitFor(() =>
      expect(screen.queryByTestId('command-palette')).toBeNull()
    );
  });

  it('narrows the commands to the term, so a search for a document is not littered with them', async () => {
    graph = await openTestGraph();
    mount(graph, [
      { id: 'export', label: 'Export as Markdown', run: () => {} },
    ]);

    act(() => screen.getByTestId('open').click());
    await screen.findByTestId('command-palette-command');

    typeTerm('quarterly');
    await waitFor(() =>
      expect(screen.queryByTestId('command-palette-command')).toBeNull()
    );

    typeTerm('mark');
    await screen.findByTestId('command-palette-command');
  });

  it('shows nothing extra when the host declares no commands', async () => {
    graph = await openTestGraph();
    mount(graph, []);

    act(() => screen.getByTestId('open').click());
    await screen.findByTestId('command-palette');
    expect(screen.queryByTestId('command-palette-command')).toBeNull();
  });
});
