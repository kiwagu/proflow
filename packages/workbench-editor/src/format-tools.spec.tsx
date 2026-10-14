import type { LexicalWrapper } from '@workspace/lexical-react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { $isHeadingNode } from '@lexical/rich-text';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { act } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentView } from './document-view.js';
import { FormatTools } from './format-tools.js';
import { TableInsert } from './table-insert.js';

afterEach(() => {
  cleanup();
});

function renderWithToolbar(props: { readOnly?: boolean } = {}) {
  let wrapper: LexicalWrapper | undefined;
  let setReadOnly: (next: boolean) => void = () => {};
  function Harness() {
    const [readOnly, setReadOnlyState] = useState(props.readOnly ?? false);
    setReadOnly = setReadOnlyState;
    return (
      <TooltipProvider>
        <DocumentView
          readOnly={readOnly}
          onWrapper={(w) => {
            wrapper = w;
          }}
        >
          <FormatTools>
            <TableInsert />
          </FormatTools>
        </DocumentView>
      </TooltipProvider>
    );
  }
  const utils = render(<Harness />);
  if (!wrapper) throw new Error('wrapper not captured');
  return {
    wrapper,
    setReadOnly: (next: boolean) => act(() => setReadOnly(next)),
    ...utils,
  };
}

/** Select all the text in the document, inside an update. */
function selectAll(wrapper: LexicalWrapper) {
  act(() => {
    wrapper.editor.update(() => {
      $getRoot().select(0, $getRoot().getChildrenSize());
    });
  });
}

describe('FormatTools', () => {
  it('renders the toolbar controls', () => {
    renderWithToolbar();
    expect(screen.getByRole('toolbar')).toBeTruthy();
    for (const label of ['Undo', 'Redo', 'Bold', 'Italic', 'Link']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('dispatches a text format from a toggle press', () => {
    const { wrapper } = renderWithToolbar();
    const dispatched: unknown[] = [];
    wrapper.editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      (format) => {
        dispatched.push(format);
        return false;
      },
      4 // COMMAND_PRIORITY_CRITICAL — observe before the editor handles it.
    );

    fireEvent.pointerDown(screen.getByLabelText('Bold'));
    expect(dispatched).toEqual(['bold']);
  });

  it('reflects the live selection formats as pressed state', async () => {
    const { wrapper } = renderWithToolbar();

    act(() => {
      wrapper.editor.update(() => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('formatted');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(0, text.getTextContentSize());
      });
      // Toggling through the command sets both the node format and the
      // selection's format bit that the toolbar reads.
      wrapper.editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
    });

    const bold = await screen.findByLabelText('Bold');
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Italic').getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('converts the selected block through the block-type select', () => {
    const { wrapper } = renderWithToolbar();

    act(() => {
      wrapper.editor.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('to be a heading'));
        $getRoot().clear().append(paragraph);
        paragraph.selectEnd();
      });
    });

    // Radix Select opens from the trigger; pick Heading 1.
    fireEvent.click(screen.getByLabelText('Block type'));
    fireEvent.click(screen.getByRole('option', { name: 'Heading 1' }));

    const isHeading = wrapper.editor.read(() => {
      const [first] = $getRoot().getChildren();
      return $isHeadingNode(first);
    });
    expect(isHeading).toBe(true);
  });

  it('dispatches undo from the undo button', () => {
    const { wrapper } = renderWithToolbar();
    const undo = vi.fn(() => true);
    wrapper.editor.registerCommand(UNDO_COMMAND, undo, 4);

    fireEvent.pointerDown(screen.getByLabelText('Undo'));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('disables editing controls when the document is read-only', () => {
    renderWithToolbar({ readOnly: true });
    expect((screen.getByLabelText('Undo') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((screen.getByLabelText('Link') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('changes nothing once the document turns read-only, with the link and table pickers already open', () => {
    const { wrapper, setReadOnly } = renderWithToolbar();
    act(() => {
      wrapper.editor.update(() => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('plain');
        paragraph.append(text);
        $getRoot().clear().append(paragraph);
        text.select(0, text.getTextContentSize());
      });
    });
    const before = JSON.stringify(wrapper.editor.getEditorState().toJSON());

    fireEvent.click(screen.getByLabelText('Link'));
    fireEvent.change(screen.getByPlaceholderText(/https/i), {
      target: { value: 'https://example.com' },
    });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    setReadOnly(true);
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();

    setReadOnly(false);
    fireEvent.click(screen.getByLabelText('Insert table'));
    expect(screen.getByRole('grid')).toBeTruthy();
    setReadOnly(true);
    expect(screen.queryByRole('grid')).toBeNull();

    for (const label of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Highlight',
    ])
      expect((screen.getByLabelText(label) as HTMLButtonElement).disabled).toBe(
        true
      );
    fireEvent.pointerDown(screen.getByLabelText('Bold'));
    expect(JSON.stringify(wrapper.editor.getEditorState().toJSON())).toBe(
      before
    );
  });

  it('keeps working when the selection spans mixed blocks', () => {
    const { wrapper } = renderWithToolbar();
    act(() => {
      wrapper.editor.update(() => {
        const a = $createParagraphNode();
        a.append($createTextNode('one'));
        const b = $createParagraphNode();
        b.append($createTextNode('two'));
        $getRoot().clear().append(a, b);
      });
    });
    selectAll(wrapper);
    // No throw and the toolbar still renders — the select just shows the
    // placeholder for a mixed/unknown selection.
    expect(screen.getByRole('toolbar')).toBeTruthy();
  });
});
