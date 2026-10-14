import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../../composition/app-services';
import type { AppServices } from '../../composition/services';
import { fireEvent, render, screen, waitFor } from '../../test-utils';
import { TrashPanel } from './trash.panel';

const mocks = vi.hoisted(() => ({
  nodes: [{ id: 'file-1', kind: 'file', title: 'Archived file' }] as Array<{
    id: string;
    kind: string;
    title: string;
    ownerUserId?: string;
  }>,
  restoreNode: vi.fn(async () => true),
  purgeNode: vi.fn(async () => true),
}));
vi.mock('@workspace/workbench-graph', async (original) => ({
  ...(await original<typeof import('@workspace/workbench-graph')>()),
  useTrashLens: () => ({
    nodes: mocks.nodes,
    isEmpty: mocks.nodes.length === 0,
  }),
  useDriveData: () => ({ containment: {} }),
  useDriveMutations: () => mocks,
}));

beforeEach(() => {
  mocks.nodes = [{ id: 'file-1', kind: 'file', title: 'Archived file' }];
});

function mount(fails = false) {
  mocks.purgeNode.mockResolvedValue(!fails);
  const freeUnused = vi.fn(async () => ok(42));
  const reportError = vi.fn();
  const services = {
    storageMaintenance: { freeUnused },
    reportError,
  } as unknown as AppServices;
  const view = render(
    <AppServicesProvider services={services}>
      <TrashPanel />
    </AppServicesProvider>
  );
  fireEvent.click(screen.getByText('Archived file'));
  return {
    freeUnused,
    reportError,
    refresh: () =>
      view.rerender(
        <AppServicesProvider services={services}>
          <TrashPanel />
        </AppServicesProvider>
      ),
  };
}

describe('trash actions', () => {
  it('cancels confirmation when its target disappears rather than deleting the next live result', async () => {
    const { refresh, freeUnused } = mount();
    fireEvent.click(screen.getByTestId('trash-purge'));
    mocks.nodes = [{ id: 'file-2', kind: 'file', title: 'Different file' }];
    refresh();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.purgeNode).not.toHaveBeenCalled();
    expect(freeUnused).not.toHaveBeenCalled();
  });
  it('confirms permanent deletion then reclaims bytes only after a successful purge', async () => {
    const { freeUnused } = mount();
    fireEvent.click(screen.getByTestId('trash-purge'));
    expect(freeUnused).not.toHaveBeenCalled();
    expect(mocks.purgeNode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(freeUnused).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('trash-purge'));
    fireEvent.click(
      screen
        .getByRole('dialog')
        .querySelector('button[data-slot="button"][class*="destructive"]')!
    );
    await waitFor(() => expect(freeUnused).toHaveBeenCalledTimes(1));
    expect(mocks.purgeNode).toHaveBeenCalledWith('file-1');
    expect(mocks.purgeNode.mock.invocationCallOrder[0]).toBeLessThan(
      freeUnused.mock.invocationCallOrder[0]!
    );
    expect((await screen.findByRole('status')).textContent).toContain('42');
  });

  it('restores without collecting garbage', async () => {
    const { freeUnused } = mount();
    fireEvent.click(screen.getByTestId('trash-restore'));
    await waitFor(() =>
      expect(mocks.restoreNode).toHaveBeenCalledWith('file-1')
    );
    expect(freeUnused).not.toHaveBeenCalled();
  });

  it('does not collect after a refused purge', async () => {
    const { freeUnused } = mount(true);
    fireEvent.click(screen.getByTestId('trash-purge'));
    fireEvent.click(
      screen
        .getByRole('dialog')
        .querySelector('button[data-slot="button"][class*="destructive"]')!
    );
    await waitFor(() => expect(mocks.purgeNode).toHaveBeenCalled());
    expect(freeUnused).not.toHaveBeenCalled();
  });

  it('reports a reclamation error rather than claiming freed bytes', async () => {
    const { freeUnused, reportError } = mount();
    freeUnused.mockResolvedValueOnce(err('storage unavailable') as never);
    fireEvent.click(screen.getByTestId('trash-purge'));
    fireEvent.click(
      screen
        .getByRole('dialog')
        .querySelector('button[data-slot="button"][class*="destructive"]')!
    );
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith('storage unavailable')
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('trash actions the person may not take', () => {
  // One object for the life of the store, as the real one keeps it: a
  // snapshot that changes on every read would never let React settle.
  const member = {
    'node.create': 'all',
    'node.update': { own: ['owner_user_id'] },
    'node.move': { own: ['parent_edge_created_by'] },
    'node.trash': { own: ['owner_user_id'] },
    'node.purge': { own: ['owner_user_id'] },
    'node.star': 'all',
    'body.write': { own: ['owner_user_id'] },
  };
  const memberScope = {
    current: () => member,
    subscribe: () => () => {},
    accept: () => {},
  };

  function mountWithScope(ownerUserId: string) {
    mocks.nodes = [
      { id: 'file-1', kind: 'file', title: 'Archived file', ownerUserId },
    ];
    const services = {
      storageMaintenance: { freeUnused: vi.fn(async () => ok(0)) },
      reportError: vi.fn(),
      writeScope: memberScope,
      identity: { userId: 'user-1', spaceId: 'space-1' },
    } as unknown as AppServices;
    render(
      <AppServicesProvider services={services}>
        <TrashPanel />
      </AppServicesProvider>
    );
    fireEvent.click(screen.getByText('Archived file'));
  }

  it("offers neither restore nor delete forever for someone else's node", () => {
    mountWithScope('user-2');
    expect(screen.queryByTestId('trash-restore')).toBeNull();
    expect(screen.queryByTestId('trash-purge')).toBeNull();
  });

  it("offers both for the person's own node", () => {
    mountWithScope('user-1');
    expect(screen.queryByTestId('trash-restore')).toBeTruthy();
    expect(screen.queryByTestId('trash-purge')).toBeTruthy();
  });
});
