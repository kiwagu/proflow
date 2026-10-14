/**
 * A document the person may read but not write opens read-only: the
 * editable refuses input, the tools are off, and a quiet line says why.
 * Whether they may write comes from the write scope the session states and
 * the owner of the node the document belongs to; a change of scope flips
 * the open pane without a remount.
 */
import type { DocumentMeta, FileNode } from '@workspace/domain';
import type { WriteScope } from '@workspace/knowledge-contracts';
import { describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../composition/app-services';
import type { AppServices } from '../composition/services';
import type { WriteScopeStore } from '../composition/write-scope';
import { act, render, screen } from '../test-utils';
import {
  DocumentChangesProvider,
  type DocumentChanges,
} from './document-changes';
import { DocumentEditor } from './document-editor';

const DOCUMENT: DocumentMeta = {
  id: 'doc-open',
  title: 'Open document',
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const MEMBER: WriteScope = {
  'node.create': 'all',
  'node.update': { own: ['owner_user_id'] },
  'node.move': { own: ['parent_edge_created_by'] },
  'node.trash': { own: ['owner_user_id'] },
  'node.purge': { own: ['owner_user_id'] },
  'node.star': 'all',
  'body.write': { own: ['owner_user_id'] },
};
const AUTHOR: WriteScope = { ...MEMBER, 'body.write': 'all' };

function scopeStore(initial: WriteScope | null) {
  let scope = initial;
  const listeners = new Set<() => void>();
  const store: WriteScopeStore = {
    current: () => scope,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    accept(next) {
      if (!next) return;
      scope = next;
      for (const listener of listeners) listener();
    },
  };
  return store;
}

const nodeOf = (ownerUserId: string): FileNode => ({
  id: 'knr-open',
  parentId: null,
  kind: 'document',
  name: DOCUMENT.title,
  mime: null,
  size: null,
  blobHash: null,
  documentId: DOCUMENT.id,
  starred: false,
  ownerUserId,
  parentEdgeCreatedBy: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const noChanges: DocumentChanges = {
  onChanged: () => () => {},
  onSettled: () => () => {},
};

function mount(input: {
  scope: WriteScope | null;
  nodes: FileNode[] | 'never';
}) {
  const save = vi.fn(() =>
    Promise.resolve({ isErr: () => false, value: true })
  );
  const writeScope = scopeStore(input.scope);
  const services = {
    documents: {
      load: () =>
        Promise.resolve({
          isErr: () => false,
          value: { meta: DOCUMENT, content: { markdown: 'Some text.' } },
        }),
      save,
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    fileTree: {
      watchAll: (cb: (nodes: FileNode[]) => void) => {
        if (input.nodes !== 'never') cb(input.nodes);
        return () => {};
      },
    },
    writeScope,
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError: () => {},
    resolveError: () => {},
  } as unknown as AppServices;
  render(
    <AppServicesProvider services={services}>
      <DocumentChangesProvider value={noChanges}>
        <DocumentEditor document={DOCUMENT} />
      </DocumentChangesProvider>
    </AppServicesProvider>
  );
  return { save, writeScope };
}

const editable = () =>
  document.querySelector('[contenteditable]')?.getAttribute('contenteditable');

describe('a document the person may not write', () => {
  it("opens read-only when the node is someone else's and the scope says own", async () => {
    mount({ scope: MEMBER, nodes: [nodeOf('user-2')] });
    await screen.findByText('Some text.');

    expect(await screen.findByTestId('document-read-only')).toBeTruthy();
    expect(editable()).toBe('false');
  });

  it("opens editable when the node is the person's own", async () => {
    mount({ scope: MEMBER, nodes: [nodeOf('user-1')] });
    await screen.findByText('Some text.');

    expect(screen.queryByTestId('document-read-only')).toBeNull();
    expect(editable()).toBe('true');
  });

  it('opens editable when there is no scope to go by', async () => {
    mount({ scope: null, nodes: [nodeOf('user-2')] });
    await screen.findByText('Some text.');

    expect(screen.queryByTestId('document-read-only')).toBeNull();
    expect(editable()).toBe('true');
  });

  it('stays editable while it does not know whose node it is yet', async () => {
    mount({ scope: MEMBER, nodes: 'never' });
    await screen.findByText('Some text.');

    expect(screen.queryByTestId('document-read-only')).toBeNull();
    expect(editable()).toBe('true');
  });

  it('turns editable in place when the scope allows it, without a remount', async () => {
    const { writeScope } = mount({ scope: MEMBER, nodes: [nodeOf('user-2')] });
    await screen.findByTestId('document-read-only');
    const before = document.querySelector('[contenteditable]');

    act(() => writeScope.accept(AUTHOR));

    expect(screen.queryByTestId('document-read-only')).toBeNull();
    expect(editable()).toBe('true');
    expect(document.querySelector('[contenteditable]')).toBe(before);
  });
});
