import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FileExplorer } from './file-explorer.js';
import { FileSelectionProvider } from './file-selection.js';
import { FileServicesProvider, type FileServices } from './file-services.js';
import { fakeServices, testNode } from './testing.js';

function mount(services: FileServices, ui = <FileExplorer />) {
  return render(
    <FileServicesProvider services={services}>
      <FileSelectionProvider>{ui}</FileSelectionProvider>
    </FileServicesProvider>
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
});
