import { render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FileExplorer } from './file-explorer.js';
import { FileSelectionProvider, useFileSelection } from './file-selection.js';
import { FileServicesProvider, type FileServices } from './file-services.js';
import { fakeServices, testNode } from './testing.js';

function mount(services: FileServices, ui = <FileExplorer />) {
  return render(
    <TooltipProvider>
      <FileServicesProvider services={services}>
        <FileSelectionProvider>{ui}</FileSelectionProvider>
      </FileServicesProvider>
    </TooltipProvider>
  );
}

const rowNames = () =>
  screen
    .queryAllByTestId('file-row')
    .map((row) => row.textContent?.trim() ?? '');

describe('the explorer over a live tree', () => {
  it('shows nothing but an invitation when the tree is empty', () => {
    mount(fakeServices([]).services);
    expect(screen.getByText(/drop files here/i)).toBeTruthy();
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);
  });

  it('renders a delivery from the reader, and every later one', async () => {
    const tree = fakeServices([testNode({ id: 'a', name: 'a.txt' })]);
    mount(tree.services);
    expect(rowNames()).toEqual(['a.txt']);

    // The tree is a live query: a second delivery must reach the rendered
    // rows without anything re-mounting or re-asking.
    act(() =>
      tree.deliver([
        testNode({ id: 'a', name: 'a.txt' }),
        testNode({ id: 'b', name: 'b.txt' }),
      ])
    );
    await waitFor(() => expect(rowNames()).toEqual(['a.txt', 'b.txt']));
  });

  it('keeps a folder shut until it is opened, then shows its children', async () => {
    const tree = fakeServices([
      testNode({
        id: 'folder',
        kind: 'folder',
        name: 'Notes',
        mime: null,
        size: null,
        blobHash: null,
      }),
      testNode({ id: 'inside', name: 'inside.txt', parentId: 'folder' }),
    ]);
    const { container } = mount(tree.services);
    // A collapsed folder must not leak its contents into the list: the
    // depth of a tree is the user's to reveal.
    expect(rowNames()).toEqual(['Notes']);

    const caret = container.querySelector('[data-testid="file-row-caret"]');
    await act(async () => {
      caret?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(rowNames()).toEqual(['Notes', 'inside.txt']));
  });

  it('says which archives have been unpacked and which have not', () => {
    const tree = fakeServices(
      [
        testNode({
          id: 'packed',
          name: 'packed.zip',
          mime: 'application/zip',
          blobHash: 'h-packed',
        }),
        testNode({
          id: 'open',
          name: 'open.zip',
          mime: 'application/zip',
          blobHash: 'h-open',
        }),
      ],
      { unpacked: ['h-open'] }
    );
    mount(tree.services);
    // The state decides what opening the file will do — unpack first, or
    // run straight away — so the row has to answer it before the click.
    expect(screen.getAllByTestId('archive-packed')).toHaveLength(1);
    expect(screen.getAllByTestId('archive-unpacked')).toHaveLength(1);
  });

  it('lists recent documents newest first, separately from the tree', () => {
    const tree = fakeServices([
      testNode({
        id: 'old',
        kind: 'document',
        name: 'Older',
        documentId: 'doc-old',
        mime: null,
        blobHash: null,
        updatedAt: new Date(1000),
      }),
      testNode({
        id: 'new',
        kind: 'document',
        name: 'Newer',
        documentId: 'doc-new',
        mime: null,
        blobHash: null,
        updatedAt: new Date(5000),
      }),
    ]);
    mount(tree.services);
    const documents = screen.getByTestId('documents-section');
    const names = Array.from(
      documents.querySelectorAll('[data-testid="file-row"]')
    ).map((row) => row.textContent?.trim());
    expect(names).toEqual(['Newer', 'Older']);
  });

  it('hides the new-document button when no document surface is wired', () => {
    // The tree is meaningful without an editor behind it; the affordance
    // is absent rather than broken.
    mount(fakeServices([]).services);
    expect(screen.queryByTestId('new-document')).toBeNull();
    expect(screen.getByTestId('new-folder')).toBeTruthy();
  });

  it('creates a folder beside the file that is selected', async () => {
    const tree = fakeServices([
      testNode({
        id: 'folder',
        kind: 'folder',
        name: 'Notes',
        mime: null,
        size: null,
        blobHash: null,
      }),
      testNode({ id: 'inside', name: 'inside.txt', parentId: 'folder' }),
    ]);
    mount(tree.services);
    // Selecting a file means the next thing created belongs where that
    // file lives, not at the root.
    const caret = document.querySelector('[data-testid="file-row-caret"]');
    await act(async () => {
      caret?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(rowNames()).toEqual(['Notes', 'inside.txt']));

    const child = screen.getAllByRole('button', { name: /inside\.txt/ })[0];
    await act(async () => {
      child?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      screen.getByTestId('new-folder').click();
    });
    await waitFor(() =>
      expect(tree.calls.createdFolders).toEqual([
        { parentId: 'folder', name: 'New folder' },
      ])
    );
  });

  it('reports an import failure to the host instead of swallowing it', async () => {
    const tree = fakeServices([], { importFails: 'disk is full' });
    mount(tree.services);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() =>
      expect(tree.calls.errors).toEqual([
        'Could not import photo.png: disk is full',
      ])
    );
  });

  it('counts the files in flight and drops the count when they land', async () => {
    const tree = fakeServices([]);
    mount(tree.services);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The placeholder is gone the moment the tree delivers the real row —
    // showing both would list the same file twice.
    await waitFor(() => {
      expect(screen.queryByTestId('importing')).toBeNull();
      expect(rowNames()).toEqual(['photo.png']);
    });
    expect(tree.calls.imported).toEqual([
      { name: 'photo.png', parentId: null },
    ]);
  });

  it('selects a new document only once its node arrives through the tree', async () => {
    const tree = fakeServices([]);
    const create = vi.fn(async () => ({ id: 'doc-1' }));
    mount(tree.services, <FileExplorer documents={{ create }} />);
    await act(async () => {
      screen.getByTestId('new-document').click();
    });
    expect(create).toHaveBeenCalledWith({ title: 'Untitled', parentId: null });
    // The node is written separately from the document, so nothing can be
    // selected until the live tree hands it over.
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);

    act(() =>
      tree.deliver([
        testNode({
          id: 'node-1',
          kind: 'document',
          name: 'Untitled',
          documentId: 'doc-1',
          mime: null,
          blobHash: null,
        }),
      ])
    );
    await waitFor(() => {
      const row = screen.getAllByTestId('file-row')[0];
      expect(row?.querySelector('[aria-current="true"]')).toBeTruthy();
    });
  });

  it('creates a document from the keyboard, through the same action as the button', async () => {
    const tree = fakeServices([]);
    const create = vi.fn(async () => ({ id: 'doc-1' }));
    mount(tree.services, <FileExplorer documents={{ create }} />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'j',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    expect(create).toHaveBeenCalledWith({ title: 'Untitled', parentId: null });
  });

  it('leaves the keystroke alone when there is no document surface to create into', async () => {
    const tree = fakeServices([]);
    mount(tree.services);

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(event);
    });

    // Nothing claimed it, so the browser keeps its own behaviour.
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not create a document while the user is typing', async () => {
    const tree = fakeServices([testNode({ id: 'a', name: 'a.txt' })]);
    const create = vi.fn(async () => ({ id: 'doc-1' }));
    mount(tree.services, <FileExplorer documents={{ create }} />);

    const field = document.createElement('input');
    document.body.appendChild(field);
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'j',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    field.remove();

    expect(create).not.toHaveBeenCalled();
  });
});

/** Opens the hover menu of the row at `index` and waits for its items. */
async function openMenu(index = 0) {
  const trigger = screen.getAllByTestId('file-menu')[index];
  await act(async () => {
    trigger?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 })
    );
    trigger?.click();
  });
  await waitFor(() =>
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
  );
}

describe('importing markdown as a document', () => {
  const pick = async (file: File) => {
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const create = vi.fn(async () => ({ id: 'doc-0' }));

  it('creates a document from a markdown file instead of storing an attachment', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pick(new File(['# Hi'], 'note.md', { type: 'text/markdown' }));
    await waitFor(() =>
      expect(importMarkdown).toHaveBeenCalledWith({
        name: 'note',
        text: '# Hi',
        parentId: null,
      })
    );
    expect(tree.calls.imported).toEqual([]);
    // A document has no bytes in flight, so nothing shows as importing.
    expect(screen.queryByTestId('importing')).toBeNull();
  });

  it('goes by the extension when the browser reports no type', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pick(new File(['# Hi'], 'note.md', { type: '' }));
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    expect(tree.calls.imported).toEqual([]);
  });

  it('keeps every other file on the attachment path', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pick(new File(['x'], 'photo.png', { type: 'image/png' }));
    await waitFor(() =>
      expect(tree.calls.imported).toEqual([
        { name: 'photo.png', parentId: null },
      ])
    );
    expect(importMarkdown).not.toHaveBeenCalled();
  });

  it('stores markdown as an attachment when no surface can import it as a document', async () => {
    const tree = fakeServices([]);
    mount(tree.services, <FileExplorer documents={{ create }} />);
    await pick(new File(['# Hi'], 'note.md', { type: 'text/markdown' }));
    await waitFor(() =>
      expect(tree.calls.imported).toEqual([{ name: 'note.md', parentId: null }])
    );
  });

  it('selects the imported document once its node arrives through the tree', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pick(new File(['# Hi'], 'note.md', { type: 'text/markdown' }));
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    expect(screen.queryAllByTestId('file-row')).toHaveLength(0);

    act(() =>
      tree.deliver([
        testNode({
          id: 'node-1',
          kind: 'document',
          name: 'note',
          documentId: 'doc-1',
          mime: null,
          blobHash: null,
        }),
      ])
    );
    await waitFor(() => {
      const row = screen.getAllByTestId('file-row')[0];
      expect(row?.querySelector('[aria-current="true"]')).toBeTruthy();
    });
  });
});

describe('exporting a document from its row', () => {
  const document = testNode({
    id: 'node-1',
    kind: 'document',
    name: 'note',
    documentId: 'doc-1',
    mime: null,
    blobHash: null,
  });
  const create = vi.fn(async () => ({ id: 'doc-0' }));

  it("exports the row's document through the surface that can render it", async () => {
    const tree = fakeServices([document]);
    const exportMarkdown = vi.fn(async () => {});
    mount(
      tree.services,
      <FileExplorer documents={{ create, exportMarkdown }} />
    );
    await openMenu();
    await act(async () => {
      screen.getByTestId('file-export-markdown').click();
    });
    expect(exportMarkdown).toHaveBeenCalledWith('doc-1');
  });

  it('offers no export for an attachment', async () => {
    const tree = fakeServices([testNode({ id: 'photo.png' })]);
    const exportMarkdown = vi.fn(async () => {});
    mount(
      tree.services,
      <FileExplorer documents={{ create, exportMarkdown }} />
    );
    await openMenu();
    expect(screen.queryByTestId('file-export-markdown')).toBeNull();
  });

  it('offers no export when no surface can render one', async () => {
    const tree = fakeServices([document]);
    mount(tree.services, <FileExplorer documents={{ create }} />);
    await openMenu();
    expect(screen.queryByTestId('file-export-markdown')).toBeNull();
  });
});

describe('selecting an imported document, whichever arrives first', () => {
  const create = vi.fn(async () => ({ id: 'doc-0' }));
  const pickAll = async (files: File[]) => {
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const noteNode = testNode({
    id: 'node-note',
    kind: 'document',
    name: 'note',
    documentId: 'doc-1',
    mime: null,
    blobHash: null,
  });
  const selectedName = () =>
    screen
      .queryAllByTestId('file-row')
      .find((row) => row.querySelector('[aria-current="true"]'))
      ?.textContent?.trim();

  it('selects the document when its node arrived before the import finished', async () => {
    const tree = fakeServices([]);
    let finish: (value: { id: string }) => void = () => {};
    const importMarkdown = vi.fn(
      () => new Promise<{ id: string }>((resolve) => (finish = resolve))
    );
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));

    // The optimistic wrapper publishes the node while the content is still
    // being written: the tree delivers first, the result second.
    act(() => tree.deliver([noteNode]));
    expect(selectedName()).toBeUndefined();
    await act(async () => finish({ id: 'doc-1' }));

    await waitFor(() => expect(selectedName()).toBe('note'));
  });

  it('lets the last import of a batch keep the selection', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([
      new File(['# Hi'], 'note.md', { type: 'text/markdown' }),
      new File(['x'], 'photo.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(selectedName()).toBe('photo.png'));

    // The document's node lands late; it must not steal the selection from
    // the file the user saw imported last.
    act(() => tree.deliver([noteNode, ...tree.nodes()]));
    await waitFor(() => expect(rowNames()).toContain('note'));
    expect(selectedName()).toBe('photo.png');
  });

  it('lets an explicit pick cancel a pending selection', async () => {
    const other = testNode({ id: 'other', name: 'other.txt' });
    const tree = fakeServices([other]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));

    // The user moves on before the node arrives.
    await act(async () => {
      screen.getByText('other.txt').click();
    });
    expect(selectedName()).toBe('other.txt');
    act(() => tree.deliver([other, noteNode]));
    await waitFor(() => expect(rowNames()).toContain('note'));
    expect(selectedName()).toBe('other.txt');
  });
});

describe('what a markdown file may contain', () => {
  const create = vi.fn(async () => ({ id: 'doc-0' }));
  const pickAll = async (files: File[]) => {
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('refuses a file that is not UTF-8 text and goes on with the rest', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async (_input: { name: string }) => ({
      id: 'doc-1',
    }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    const cp1251 = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    await pickAll([
      new File([cp1251], 'legacy.md', { type: 'text/markdown' }),
      new File(['# Hi'], 'good.md', { type: 'text/markdown' }),
    ]);
    await waitFor(() =>
      expect(tree.calls.errors).toEqual([
        'Could not import legacy.md: the file is not UTF-8 text',
      ])
    );
    expect(importMarkdown).toHaveBeenCalledTimes(1);
    expect(importMarkdown.mock.calls[0]?.[0]).toMatchObject({ name: 'good' });
  });

  it('gives a file that is only an extension the untitled name', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async (_input: { name: string }) => ({
      id: 'doc-1',
    }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([new File(['# Hi'], '.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    expect(importMarkdown.mock.calls[0]?.[0]).toMatchObject({
      name: 'Untitled',
    });
  });
});

describe('a pick made while an import is still answering', () => {
  const create = vi.fn(async () => ({ id: 'doc-0' }));
  const pickAll = async (files: File[]) => {
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const noteNode = testNode({
    id: 'node-note',
    kind: 'document',
    name: 'note',
    documentId: 'doc-1',
    mime: null,
    blobHash: null,
  });
  const other = testNode({ id: 'other', name: 'other.txt' });
  const selectedName = () =>
    screen
      .queryAllByTestId('file-row')
      .find((row) => row.querySelector('[aria-current="true"]'))
      ?.textContent?.trim();
  /** The palette's route to the same selection, from outside the explorer. */
  let selectFromOutside: (id: string) => void = () => {};
  function Palette() {
    selectFromOutside = useFileSelection().setOpenFileId;
    return null;
  }
  const deferredImport = () => {
    let finish: (value: { id: string }) => void = () => {};
    const importMarkdown = vi.fn(
      () => new Promise<{ id: string }>((resolve) => (finish = resolve))
    );
    return { importMarkdown, finish: (id: string) => finish({ id }) };
  };

  it('keeps a pick by hand made before the import answered', async () => {
    const tree = fakeServices([other]);
    const { importMarkdown, finish } = deferredImport();
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    act(() => tree.deliver([other, noteNode]));

    await act(async () => {
      screen.getByText('other.txt').click();
    });
    await act(async () => finish('doc-1'));

    expect(selectedName()).toBe('other.txt');
  });

  it('keeps a pick made from the palette before the import answered', async () => {
    const tree = fakeServices([other]);
    const { importMarkdown, finish } = deferredImport();
    mount(
      tree.services,
      <>
        <Palette />
        <FileExplorer documents={{ create, importMarkdown }} />
      </>
    );
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    act(() => tree.deliver([other, noteNode]));

    act(() => selectFromOutside('other'));
    await act(async () => finish('doc-1'));

    expect(selectedName()).toBe('other.txt');
  });

  it('survives an unrelated tree delivery while still waiting for the node', async () => {
    const tree = fakeServices([other]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await act(async () => {
      screen.getByText('other.txt').click();
    });
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));

    // Something else changes in the tree before the awaited node arrives.
    act(() =>
      tree.deliver([other, testNode({ id: 'stranger', name: 'stranger.txt' })])
    );
    act(() =>
      tree.deliver([
        other,
        testNode({ id: 'stranger', name: 'stranger.txt' }),
        noteNode,
      ])
    );

    await waitFor(() => expect(selectedName()).toBe('note'));
  });

  it('keeps a pick that lands in the same commit as the awaited node', async () => {
    const tree = fakeServices([other]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <>
        <Palette />
        <FileExplorer documents={{ create, importMarkdown }} />
      </>
    );
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));

    act(() => {
      selectFromOutside('other');
      tree.deliver([other, noteNode]);
    });

    await waitFor(() => expect(rowNames()).toContain('note'));
    expect(selectedName()).toBe('other.txt');
  });
});

describe('automatic selections inside one batch', () => {
  const create = vi.fn(async () => ({ id: 'doc-0' }));
  const pickAll = async (files: File[]) => {
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const documentNode = (name: string, documentId: string) =>
    testNode({
      id: `node-${name}`,
      kind: 'document',
      name,
      documentId,
      mime: null,
      blobHash: null,
    });
  const selectedName = () =>
    screen
      .queryAllByTestId('file-row')
      .find((row) => row.querySelector('[aria-current="true"]'))
      ?.textContent?.trim();

  it('lets the second markdown file of a batch take the selection after the first opened itself', async () => {
    const tree = fakeServices([]);
    let finishA: (value: { id: string }) => void = () => {};
    const importMarkdown = vi.fn((input: { name: string }) =>
      input.name === 'a'
        ? new Promise<{ id: string }>((resolve) => (finishA = resolve))
        : Promise.resolve({ id: 'doc-b' })
    );
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([
      new File(['# A'], 'a.md', { type: 'text/markdown' }),
      new File(['# B'], 'b.md', { type: 'text/markdown' }),
    ]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));

    // A's node is already in the tree when A answers: A opens itself, and
    // that automatic opening is not a pick by the user.
    act(() => tree.deliver([documentNode('a', 'doc-a')]));
    await act(async () => finishA({ id: 'doc-a' }));
    await waitFor(() => expect(selectedName()).toBe('a'));
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(2));

    act(() =>
      tree.deliver([documentNode('a', 'doc-a'), documentNode('b', 'doc-b')])
    );
    await waitFor(() => expect(selectedName()).toBe('b'));
  });

  it('lets a markdown file that follows an attachment take the selection', async () => {
    const tree = fakeServices([]);
    const importMarkdown = vi.fn(async () => ({ id: 'doc-1' }));
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await pickAll([
      new File(['x'], 'photo.png', { type: 'image/png' }),
      new File(['# Hi'], 'note.md', { type: 'text/markdown' }),
    ]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));

    act(() => tree.deliver([...tree.nodes(), documentNode('note', 'doc-1')]));
    await waitFor(() => expect(selectedName()).toBe('note'));
  });

  it('treats picking the already selected file again as a pick', async () => {
    const other = testNode({ id: 'other', name: 'other.txt' });
    const tree = fakeServices([other]);
    let finish: (value: { id: string }) => void = () => {};
    const importMarkdown = vi.fn(
      () => new Promise<{ id: string }>((resolve) => (finish = resolve))
    );
    mount(
      tree.services,
      <FileExplorer documents={{ create, importMarkdown }} />
    );
    await act(async () => {
      screen.getByText('other.txt').click();
    });
    await pickAll([new File(['# Hi'], 'note.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    act(() => tree.deliver([other, documentNode('note', 'doc-1')]));

    // The user confirms the file they already have open, while the import
    // is still answering.
    await act(async () => {
      screen.getByText('other.txt').click();
    });
    await act(async () => finish({ id: 'doc-1' }));

    expect(selectedName()).toBe('other.txt');
  });
});

describe('the marker of an automatic selection', () => {
  const create = vi.fn(async () => ({ id: 'doc-0' }));
  const pickAll = async (files: File[]) => {
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  const selectedName = () =>
    screen
      .queryAllByTestId('file-row')
      .find((row) => row.querySelector('[aria-current="true"]'))
      ?.textContent?.trim();
  let selectFromOutside: (id: string) => void = () => {};
  function Palette() {
    selectFromOutside = useFileSelection().setOpenFileId;
    return null;
  }

  it('does not outlive its transition and mistake a later pick from the palette for its own', async () => {
    const b = testNode({ id: 'b', name: 'b.txt' });
    const tree = fakeServices([b], { importDeferred: true });
    let finishC: (value: { id: string }) => void = () => {};
    const importMarkdown = vi.fn(
      () => new Promise<{ id: string }>((resolve) => (finishC = resolve))
    );
    mount(
      tree.services,
      <>
        <Palette />
        <FileExplorer documents={{ create, importMarkdown }} />
      </>
    );

    // An attachment A: its node is in the tree before the import answers, and
    // the user opens it by hand meanwhile — so the answer's automatic
    // selection of A changes nothing.
    await pickAll([new File(['x'], 'a.png', { type: 'image/png' })]);
    await waitFor(() => expect(rowNames()).toContain('a.png'));
    await act(async () => {
      screen.getByText('a.png').click();
    });
    await act(async () => tree.finishImports());
    expect(selectedName()).toBe('a.png');

    // The user moves to B, then starts importing a markdown file C.
    await act(async () => {
      screen.getByText('b.txt').click();
    });
    await pickAll([new File(['# C'], 'c.md', { type: 'text/markdown' })]);
    await waitFor(() => expect(importMarkdown).toHaveBeenCalledTimes(1));
    act(() =>
      tree.deliver([
        ...tree.nodes(),
        testNode({
          id: 'node-c',
          kind: 'document',
          name: 'c',
          documentId: 'doc-c',
          mime: null,
          blobHash: null,
        }),
      ])
    );

    // A REAL pick, B → A, through the palette's route: it must count.
    const aId = tree.nodes().find((n) => n.name === 'a.png')!.id;
    act(() => selectFromOutside(aId));
    await act(async () => finishC({ id: 'doc-c' }));

    expect(selectedName()).toBe('a.png');
  });
});
