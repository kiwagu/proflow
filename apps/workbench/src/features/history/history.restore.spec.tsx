/**
 * Restoring a version, through the app's own ports.
 *
 * The panel itself is a pure view and is asserted as one in its package. What
 * cannot be asserted there is the part that only exists in the app: that
 * restore reaches the version STORE (not the read-only preview path), carries
 * the signed-in user as the author, leaves the history LONGER than it found it,
 * and makes the editor show the restored document rather than the one it had
 * mounted with.
 */
import type {
  DocumentVersion,
  IDocumentVersionStore,
  SerializedTree,
} from '@workspace/domain';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../../composition/app-services';
import type { AppServices } from '../../composition/services';
import { fireEvent, render, screen, waitFor } from '../../test-utils';
import { DocumentEditor } from '../document-editor';
import { DocumentRevisionProvider } from '../document-revision';
import { HistoryPanelContainer } from './history.container';

const DOCUMENT_ID = 'doc-1';
const USER_ID = 'user-1';

const DRAFT = 'v1';
const FINAL = 'v1 v2';

function tree(text: string): SerializedTree {
  return {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
    },
  };
}

function version(id: string, minutesAgo: number): DocumentVersion {
  return {
    id,
    documentId: DOCUMENT_ID,
    label: null,
    kind: 'idle',
    ref: { at: id },
    createdAt: new Date(Date.now() - minutesAgo * 60_000),
  };
}

/**
 * The version store as the app reaches it, plus the document it is the
 * history OF: restoring rewrites the stored document, which is what the
 * editor must then read.
 */
function stubWorld() {
  const versions: DocumentVersion[] = [version('v-1', 10), version('v-2', 1)];
  let storedTree = tree(FINAL);

  const store: IDocumentVersionStore = {
    mark: vi.fn(async ({ documentId, kind }) => {
      const marked: DocumentVersion = {
        id: `v-${versions.length + 1}`,
        documentId,
        label: null,
        kind,
        ref: { at: `v-${versions.length + 1}` },
        createdAt: new Date(),
      };
      versions.push(marked);
      return ok(marked);
    }),
    list: vi.fn(async () => ok([...versions])),
    listEdits: vi.fn(async () => ok([])),
    readAt: vi.fn(async () => ok(tree('v1'))),
    // Restore is the write: it returns the document to the marked state,
    // and the history keeps everything that came after.
    restore: vi.fn(async () => {
      storedTree = tree(DRAFT);
      return ok(undefined);
    }),
  };

  const services = {
    documents: {
      invalidate: vi.fn(),
      // The stored pair as the real store leaves it after a restore: the
      // canonical TREE went back, while the derived markdown is still the
      // text from before. A surface that mounts on markdown would show the
      // restore as having done nothing, so the stub keeps the divergence
      // rather than hiding it.
      load: async () =>
        ok({
          meta: { id: DOCUMENT_ID },
          content: { tree: storedTree, markdown: FINAL },
        }),
      save: async () => ok(null),
    },
    documentVersions: store,
    identity: { userId: USER_ID, spaceId: 'space-1' },
    reportError: vi.fn(),
  } as unknown as AppServices;

  return { services, store, versions, invalidated: services.documents };
}

const DOCUMENT_META = {
  id: DOCUMENT_ID,
  title: 'Draft',
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as const;

function mount(services: AppServices) {
  return render(
    <AppServicesProvider services={services}>
      <DocumentRevisionProvider>
        <DocumentEditor document={DOCUMENT_META} />
        <HistoryPanelContainer documentId={DOCUMENT_ID} />
      </DocumentRevisionProvider>
    </AppServicesProvider>
  );
}

describe('restoring a version from the history panel', () => {
  it('writes through the version store as the signed-in user, and the editor then shows the restored document', async () => {
    const { services, store, versions } = stubWorld();
    mount(services);

    // The editor mounted on the document as it stands.
    await screen.findByText('v1 v2');
    const before = versions.length;

    const rows = await screen.findAllByTestId('history-version');
    fireEvent.click(rows[1]!);
    fireEvent.click(await screen.findByTestId('history-restore'));

    await waitFor(() => expect(store.restore).toHaveBeenCalledTimes(1));
    expect(store.restore).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      ref: { at: 'v-1' },
      author: { user: USER_ID, src: 'human' },
    });
    // Read-only preview writes nothing: restoring must not be served by it.
    expect(services.documents.invalidate).toHaveBeenCalledWith(DOCUMENT_ID);

    // The stored document became the earlier one, and the surface shows it.
    await waitFor(() => expect(screen.getByText('v1')).toBeTruthy());
    expect(screen.queryByText('v1 v2')).toBeNull();

    // History grows by the restore rather than losing what came after it.
    await waitFor(() =>
      expect(screen.getAllByTestId('history-version').length).toBe(before + 1)
    );
  });

  it('previews a version without touching the document', async () => {
    const { services, store } = stubWorld();
    mount(services);
    await screen.findByText('v1 v2');

    fireEvent.click((await screen.findAllByTestId('history-version'))[1]!);

    await waitFor(() => expect(store.readAt).toHaveBeenCalledTimes(1));
    expect(store.restore).not.toHaveBeenCalled();
    expect(services.documents.invalidate).not.toHaveBeenCalled();
    expect(screen.getByTestId('history-preview')).toBeTruthy();
  });
});

describe('history of a document the person may not write', () => {
  it('previews a version but offers no restore, and the store is never asked to restore', async () => {
    const { services, store } = stubWorld();
    const member = {
      'node.create': 'all',
      'node.update': { own: ['owner_user_id'] },
      'node.move': { own: ['parent_edge_created_by'] },
      'node.trash': { own: ['owner_user_id'] },
      'node.purge': { own: ['owner_user_id'] },
      'node.star': 'all',
      'body.write': { own: ['owner_user_id'] },
    };
    const withScope = {
      ...services,
      writeScope: {
        current: () => member,
        subscribe: () => () => {},
        accept: () => {},
      },
      fileTree: {
        watchAll: (cb: (nodes: unknown[]) => void) => {
          cb([
            {
              id: 'knr-1',
              documentId: DOCUMENT_ID,
              ownerUserId: 'someone-else',
            },
          ]);
          return () => {};
        },
      },
    } as unknown as AppServices;
    mount(withScope);

    await screen.findByText('v1 v2');
    const rows = await screen.findAllByTestId('history-version');
    fireEvent.click(rows[1]!);
    await screen.findByTestId('history-preview');

    expect(screen.queryByTestId('history-restore')).toBeNull();
    expect(store.restore).not.toHaveBeenCalled();
  });
});
