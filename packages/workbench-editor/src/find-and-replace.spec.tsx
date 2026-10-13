import type { LexicalWrapper } from '@workspace/lexical-react';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import {
  render,
  cleanup,
  fireEvent,
  screen,
  act,
  waitFor,
} from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { DocumentView } from './document-view.js';
import { FindAndReplace } from './find-and-replace.js';

afterEach(() => {
  cleanup();
});

function renderFindAndReplace() {
  let wrapper: LexicalWrapper | undefined;
  let setOpen: (next: boolean) => void = () => {};
  function Wrapped() {
    const [open, setOpenState] = useState(true);
    setOpen = setOpenState;
    return (
      <TooltipProvider>
        <DocumentView
          onWrapper={(w: LexicalWrapper) => {
            wrapper = w;
          }}
        >
          <FindAndReplace open={open} onOpenChange={setOpenState} />
        </DocumentView>
      </TooltipProvider>
    );
  }
  const utils = render(<Wrapped />);
  if (!wrapper) throw new Error('wrapper not captured');
  return { wrapper, setOpen, ...utils };
}

function loadParagraph(wrapper: LexicalWrapper, text: string) {
  act(() => {
    wrapper.editor.update(() => {
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append($createTextNode(text));
      root.append(p);
    });
  });
}

describe('FindAndReplace', () => {
  it('renders the search field when open', () => {
    renderFindAndReplace();
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByPlaceholderText('Find…')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    function Wrapped() {
      const [open] = useState(false);
      return (
        <TooltipProvider>
          <DocumentView>
            <FindAndReplace open={open} onOpenChange={() => {}} />
          </DocumentView>
        </TooltipProvider>
      );
    }
    render(<Wrapped />);
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('reports match status after a search', async () => {
    const { wrapper } = renderFindAndReplace();
    loadParagraph(wrapper, 'cat cat cat');

    fireEvent.change(screen.getByPlaceholderText('Find…'), {
      target: { value: 'cat' },
    });

    await waitFor(() => {
      expect(screen.getByText('1 of 3')).toBeTruthy();
    });
  });

  it('replaces the current match and updates the document', async () => {
    const { wrapper } = renderFindAndReplace();
    loadParagraph(wrapper, 'cat cat cat');

    fireEvent.change(screen.getByPlaceholderText('Find…'), {
      target: { value: 'cat' },
    });
    await waitFor(() => screen.getByText('1 of 3'));

    fireEvent.change(screen.getByPlaceholderText('Replace with…'), {
      target: { value: 'dog' },
    });
    fireEvent.click(screen.getByLabelText('Replace'));

    const text = wrapper.editor
      .getEditorState()
      .read(() => $getRoot().getTextContent());
    expect(text).toBe('dog cat cat');
  });

  it('replaces every match with replace-all', async () => {
    const { wrapper } = renderFindAndReplace();
    loadParagraph(wrapper, 'cat cat cat');

    fireEvent.change(screen.getByPlaceholderText('Find…'), {
      target: { value: 'cat' },
    });
    await waitFor(() => screen.getByText('1 of 3'));

    fireEvent.change(screen.getByPlaceholderText('Replace with…'), {
      target: { value: 'dog' },
    });
    fireEvent.click(screen.getByLabelText('Replace all'));

    const text = wrapper.editor
      .getEditorState()
      .read(() => $getRoot().getTextContent());
    expect(text).toBe('dog dog dog');
  });

  it('shows no-matches for a query with no hits', async () => {
    const { wrapper } = renderFindAndReplace();
    loadParagraph(wrapper, 'cat cat cat');

    fireEvent.change(screen.getByPlaceholderText('Find…'), {
      target: { value: 'zzz' },
    });

    await waitFor(() => {
      expect(screen.getByText('No matches')).toBeTruthy();
    });
  });

  it('closes on the close button', () => {
    renderFindAndReplace();
    fireEvent.click(screen.getByLabelText('Close'));
    // The button dispatches onOpenChange(false); the harness component
    // re-renders through its own state, so the search field goes away.
    expect(screen.queryByRole('search')).toBeNull();
  });
});
