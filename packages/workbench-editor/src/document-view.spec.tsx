import type { LexicalWrapper } from '@workspace/lexical-react';
import { $isTableNode, INSERT_TABLE_COMMAND, TableNode } from '@lexical/table';
import { render, cleanup, act } from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { $getId } from '@workspace/lexical-nodes';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentView } from './document-view.js';

afterEach(() => {
  cleanup();
});

function lastWrapper(): {
  ref: () => LexicalWrapper;
  onWrapper: (w: LexicalWrapper) => void;
} {
  let wrapper: LexicalWrapper | undefined;
  return {
    ref: () => {
      if (!wrapper) throw new Error('wrapper not captured');
      return wrapper;
    },
    onWrapper: (w) => {
      wrapper = w;
    },
  };
}

describe('DocumentView', () => {
  it('assigns durable ids to loaded and newly edited nodes for CRDT persistence', async () => {
    const capture = lastWrapper();
    render(
      <DocumentView
        initialMarkdown="Existing text"
        onWrapper={capture.onWrapper}
      />
    );
    const editor = capture.ref().editor;
    await act(async () => {
      editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append($createTextNode('New text'))
          );
        },
        { discrete: true }
      );
    });
    editor.read(() => {
      const paragraphs = $getRoot().getChildren();
      expect(paragraphs).toHaveLength(2);
      for (const paragraph of paragraphs) {
        expect($getId(paragraph)).toBeTruthy();
      }
    });
  });
  it('mounts an editable markdown surface and exposes the wrapper', () => {
    const capture = lastWrapper();
    const { container } = render(
      <DocumentView onWrapper={capture.onWrapper} />
    );

    const editable = container.querySelector('[data-lexical-editor]');
    expect(editable).not.toBeNull();
    const wrapper = capture.ref();
    expect(wrapper.type).toBe('markdown');
    expect(wrapper.editor.getRootElement()).toBe(editable);
    expect(wrapper.isInteractable()).toBe(true);
  });

  it('loads initial markdown into the document once', () => {
    const capture = lastWrapper();
    render(
      <DocumentView
        initialMarkdown={'# Title\n\nBody text'}
        onWrapper={capture.onWrapper}
      />
    );

    const text = capture.ref().editor.read(() => $getRoot().getTextContent());
    expect(text).toContain('Title');
    expect(text).toContain('Body text');
  });

  it('publishes live selection data through the wrapper', () => {
    const capture = lastWrapper();
    render(<DocumentView onWrapper={capture.onWrapper} />);
    // The selection plugin ran at mount and attached its store.
    expect(capture.ref().selection).toBeDefined();
    expect(capture.ref().selection?.get().type).toBeNull();
  });

  it('reads readOnly live rather than at mount', () => {
    const capture = lastWrapper();
    const { rerender } = render(
      <DocumentView readOnly={false} onWrapper={capture.onWrapper} />
    );
    const wrapper = capture.ref();
    expect(wrapper.isInteractable()).toBe(true);

    rerender(<DocumentView readOnly onWrapper={capture.onWrapper} />);
    // Same wrapper (no remount), new answer.
    expect(capture.ref()).toBe(wrapper);
    expect(wrapper.isInteractable()).toBe(false);
  });

  it('takes typing away while read-only, and gives it back without a remount', () => {
    const capture = lastWrapper();
    const { rerender } = render(
      <DocumentView readOnly onWrapper={capture.onWrapper} />
    );
    const editor = capture.ref().editor;
    const surface = () =>
      document
        .querySelector('[data-lexical-editor]')
        ?.getAttribute('contenteditable');
    // A reader's keystrokes never reach the document: the editable itself
    // refuses them, not only the tools around it — in the editor and in the
    // page, where the browser decides whether typing lands at all.
    expect(editor.isEditable()).toBe(false);
    expect(surface()).toBe('false');

    rerender(<DocumentView readOnly={false} onWrapper={capture.onWrapper} />);
    expect(capture.ref().editor).toBe(editor);
    expect(editor.isEditable()).toBe(true);
    expect(surface()).toBe('true');
  });

  it('registers table support so a table command produces a table', () => {
    const capture = lastWrapper();
    render(<DocumentView onWrapper={capture.onWrapper} />);
    const editor = capture.ref().editor;

    expect(editor.hasNode(TableNode)).toBe(true);

    act(() => {
      editor.update(() => {
        $getRoot().selectEnd();
      });
      editor.dispatchCommand(INSERT_TABLE_COMMAND, { rows: '2', columns: '3' });
    });

    const hasTable = editor.read(() =>
      $getRoot().getChildren().some($isTableNode)
    );
    expect(hasTable).toBe(true);
  });
});
