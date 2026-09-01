import type { LexicalWrapper } from '@workspace/lexical-react';
import { TRY_INSERT_TABLE_PICKER_COMMAND } from '@workspace/lexical-react';
import { $isTableNode } from '@lexical/table';
import {
  render,
  cleanup,
  fireEvent,
  screen,
  act,
} from '@testing-library/react';
import { $getRoot } from 'lexical';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentView } from './document-view.js';
import { TableInsert } from './table-insert.js';

afterEach(() => {
  cleanup();
});

function renderWithPicker() {
  let wrapper: LexicalWrapper | undefined;
  const utils = render(
    <TooltipProvider>
      <DocumentView
        onWrapper={(w) => {
          wrapper = w;
        }}
      >
        <TableInsert />
      </DocumentView>
    </TooltipProvider>
  );
  if (!wrapper) throw new Error('wrapper not captured');
  return { wrapper, ...utils };
}

describe('TableInsert', () => {
  it('renders the trigger and opens the size grid', () => {
    renderWithPicker();
    fireEvent.click(screen.getByLabelText('Insert table'));
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByLabelText('2 × 3 table')).toBeTruthy();
  });

  it('inserts a table of the picked size', () => {
    const { wrapper } = renderWithPicker();
    act(() => {
      wrapper.editor.update(() => {
        $getRoot().selectEnd();
      });
    });

    fireEvent.click(screen.getByLabelText('Insert table'));
    fireEvent.click(screen.getByLabelText('2 × 3 table'));

    const table = wrapper.editor.read(() =>
      $getRoot().getChildren().find($isTableNode)
    );
    expect(table).toBeDefined();
    expect(wrapper.editor.read(() => table!.getChildrenSize())).toBe(2);
  });

  it('opens when the editor requests the picker by command', () => {
    const { wrapper } = renderWithPicker();
    expect(screen.queryByRole('grid')).toBeNull();

    act(() => {
      wrapper.editor.dispatchCommand(
        TRY_INSERT_TABLE_PICKER_COMMAND,
        undefined
      );
    });

    expect(screen.getByRole('grid')).toBeTruthy();
  });
});
