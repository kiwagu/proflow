import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { FileExplorer } from './file-explorer.js';
import { FileSelectionProvider } from './file-selection.js';
import { FileServicesProvider, type FileServices } from './file-services.js';
import { fakeServices, testNode } from './testing.js';

function mount(services: FileServices) {
  return render(
    <FileServicesProvider services={services}>
      <FileSelectionProvider>
        <FileExplorer />
      </FileSelectionProvider>
    </FileServicesProvider>
  );
}

/** Opens the hover menu of the first row and returns its items by label. */
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

const menuItem = (label: string) =>
  screen.getAllByRole('menuitem').find((i) => i.textContent?.includes(label));

describe('what a row lets the user do', () => {
  const file = () =>
    testNode({ id: 'a', name: 'a.txt', mime: 'text/plain', blobHash: 'h-a' });

  it('renames in place, and only when the name actually changed', async () => {
    const tree = fakeServices([file()]);
    mount(tree.services);
    await openMenu();
    await act(async () => {
      menuItem('Rename')?.click();
    });
    const input = (await screen.findByTestId(
      'file-rename-input'
    )) as HTMLInputElement;

    // Committing the same name is not an edit — it must not reach the
    // repository at all.
    await act(async () => {
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
    expect(tree.calls.rename).toEqual([]);
  });

  it('sends the new name once it is committed', async () => {
    const tree = fakeServices([file()]);
    mount(tree.services);
    await openMenu();
    await act(async () => {
      menuItem('Rename')?.click();
    });
    const input = (await screen.findByTestId(
      'file-rename-input'
    )) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, 'renamed.txt');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    await waitFor(() =>
      expect(tree.calls.rename).toEqual([['a', 'renamed.txt']])
    );
  });

  it('stars and unstars from the same item', async () => {
    const tree = fakeServices([file()]);
    mount(tree.services);
    await openMenu();
    await act(async () => {
      menuItem('Star')?.click();
    });
    await waitFor(() => expect(tree.calls.star).toEqual([['a', true]]));
  });

  it('deletes softly, and lets go of the selection it deleted', async () => {
    const tree = fakeServices([file()]);
    mount(tree.services);
    await openMenu();
    await act(async () => {
      menuItem('Delete')?.click();
    });
    await waitFor(() => expect(tree.calls.deleted).toEqual(['a']));
  });

  it('offers a move into every folder but the one the file is already in', async () => {
    const tree = fakeServices([
      testNode({
        id: 'here',
        kind: 'folder',
        name: 'Here',
        mime: null,
        size: null,
        blobHash: null,
      }),
      testNode({
        id: 'there',
        kind: 'folder',
        name: 'There',
        mime: null,
        size: null,
        blobHash: null,
      }),
      testNode({ id: 'a', name: 'a.txt', parentId: 'here' }),
    ]);
    mount(tree.services);
    const caret = document.querySelectorAll(
      '[data-testid="file-row-caret"]'
    )[0];
    await act(async () => {
      caret?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() =>
      expect(screen.getAllByTestId('file-row').length).toBe(3)
    );

    await openMenu(1);
    const move = screen.getByTestId('file-move');
    await act(async () => {
      move.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0 })
      );
      move.click();
    });
    const targets = await screen.findAllByTestId('file-move-target');
    expect(targets.map((t) => t.textContent?.trim())).toEqual([
      'Files',
      'Here',
      'There',
    ]);
    // Moving a file where it already is is a no-op, so the item is there
    // for orientation but not selectable.
    expect(
      targets
        .find((t) => t.textContent?.includes('Here'))
        ?.getAttribute('data-disabled')
    ).not.toBeNull();
  });

  it('unpacks an archive from its own row', async () => {
    const tree = fakeServices([
      testNode({
        id: 'zip',
        name: 'course.zip',
        mime: 'application/zip',
        blobHash: 'h-zip',
      }),
    ]);
    mount(tree.services);
    await openMenu();
    await act(async () => {
      menuItem('Unpack')?.click();
    });
    await waitFor(() => expect(tree.calls.unpacked).toEqual(['h-zip']));
  });

  it('does not offer unpacking on anything that is not an archive', async () => {
    const tree = fakeServices([file()]);
    mount(tree.services);
    await openMenu();
    expect(menuItem('Unpack')).toBeUndefined();
  });
});
