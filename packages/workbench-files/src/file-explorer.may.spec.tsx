import { render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { FileExplorer } from './file-explorer.js';
import { FileSelectionProvider } from './file-selection.js';
import { FileServicesProvider, type FileServices } from './file-services.js';
import { fakeServices, testNode } from './testing.js';

/**
 * The tree offers only what the person may do. The host says what that is
 * through `may`; without it every control is there, as before.
 */

function mount(services: FileServices) {
  return render(
    <TooltipProvider>
      <FileServicesProvider services={services}>
        <FileSelectionProvider>
          <FileExplorer />
        </FileSelectionProvider>
      </FileServicesProvider>
    </TooltipProvider>
  );
}

async function openMenu(name: string) {
  const row = screen
    .getAllByTestId('file-row')
    .find((r) => r.textContent?.includes(name));
  const trigger = row?.querySelector<HTMLElement>('[data-testid="file-menu"]');
  await act(async () => {
    trigger?.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 })
    );
    trigger?.click();
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeTruthy());
}

const menuItems = () =>
  screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim());

const folder = testNode({
  id: 'folder',
  kind: 'folder',
  name: 'Shared',
  mime: null,
  size: null,
  blobHash: null,
});
const doc = testNode({ id: 'doc', name: 'Their note.md', parentId: null });

describe('a tree the person may not change everywhere', () => {
  it('offers every action when the host says nothing about rights', async () => {
    mount(fakeServices([doc, folder]).services);
    await openMenu('Their note.md');
    const items = menuItems().join('|');
    expect(items).toMatch(/rename/i);
    expect(items).toMatch(/star/i);
    expect(items).toMatch(/move/i);
    expect(screen.queryByTestId('file-delete')).toBeTruthy();
    expect(screen.queryByTestId('new-folder')).toBeTruthy();
  });

  it('leaves out rename, move, delete and star where the host says no', async () => {
    const { services } = fakeServices([doc, folder]);
    mount({
      ...services,
      may: (action, node) => node?.id !== 'doc' || action === 'node.create',
    });
    await openMenu('Their note.md');
    const items = menuItems().join('|');
    expect(items).not.toMatch(/rename/i);
    expect(items).not.toMatch(/star/i);
    expect(items).not.toMatch(/move/i);
    expect(screen.queryByTestId('file-delete')).toBeNull();
  });

  it("offers no trash for a folder of one's own that holds someone else's node", async () => {
    const mine = testNode({
      id: 'mine',
      kind: 'folder',
      name: 'My folder',
      mime: null,
      size: null,
      blobHash: null,
      ownerUserId: 'me',
    });
    const theirs = testNode({
      id: 'theirs',
      name: 'Filed by someone else.md',
      parentId: 'mine',
      ownerUserId: 'other',
    });
    const { services } = fakeServices([mine, theirs]);
    mount({
      ...services,
      may: (action, node) =>
        action === 'node.create' || node?.ownerUserId === 'me',
    });
    await openMenu('My folder');
    // Trashing a folder trashes what it holds, and the server refuses to
    // trash someone else's node for a person without the delete right.
    expect(screen.queryByTestId('file-delete')).toBeNull();
    expect(menuItems().join('|')).toMatch(/rename/i);
  });

  it('does not start renaming on a double click the host says no to', async () => {
    const { services } = fakeServices([doc]);
    mount({ ...services, may: () => false });
    const row = screen.getAllByTestId('file-row')[0]!;
    await act(async () => {
      row
        .querySelector('[style*="padding-left"]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(screen.queryByTestId('file-rename-input')).toBeNull();
  });

  it('leaves out the create and upload controls when creating is not allowed', () => {
    const { services } = fakeServices([doc]);
    mount({ ...services, may: (action) => action !== 'node.create' });
    expect(screen.queryByTestId('new-folder')).toBeNull();
    expect(screen.queryByTestId('upload-files')).toBeNull();
    expect(screen.queryByTestId('file-input')).toBeNull();
  });
});
