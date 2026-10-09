/**
 * What another device wrote, landing in the open editor.
 *
 * The merge itself is the store's (covered against real databases); what
 * the pane owes is to paint the merged tree without treating the paint as
 * typing, to drop a save the merge made stale, to keep saving what is typed
 * afterwards, and to open with the body when it arrives for a document
 * that was still waiting for the server.
 */
import type { DocumentMeta, SerializedTree } from '@workspace/domain';
import type {
  AgentWorkerClient,
  EditOutcome,
  OpenDocumentHooks,
} from '@workspace/ai-agent';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { AgentProvider } from '@workspace/workbench-agent';
import { $getRoot, type ElementNode } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../composition/app-services';
import type { AppServices } from '../composition/services';
import { act, render, screen, waitFor } from '../test-utils';
import {
  DocumentChangesProvider,
  type DocumentChange,
  type DocumentChanges,
} from './document-changes';
import { DocumentEditor } from './document-editor';
import { createLiveEditors, LiveEditorsProvider } from './live-editor';

const DOCUMENT: DocumentMeta = {
  id: 'doc-open',
  title: 'Open document',
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const treeOf = (markdown: string): SerializedTree =>
  markdownToState(markdown).state as unknown as SerializedTree;

function stubServices(load: { markdown: string } | 'awaiting') {
  const save = vi.fn((_input: { markdown: string }) =>
    Promise.resolve({ isErr: () => false, value: true })
  );
  const services = {
    documents: {
      load: () =>
        Promise.resolve({
          isErr: () => false,
          value:
            load === 'awaiting'
              ? { meta: DOCUMENT, content: null, awaitingSync: true }
              : { meta: DOCUMENT, content: load },
        }),
      save,
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError: () => {},
    resolveError: () => {},
  } as unknown as AppServices;
  return { services, save };
}

function feed(): {
  changes: DocumentChanges;
  emit: (e: DocumentChange) => void;
} {
  const listeners = new Set<(e: DocumentChange) => void>();
  return {
    changes: {
      onChanged(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}

function recordingClient(): {
  client: AgentWorkerClient;
  hooks: () => OpenDocumentHooks | undefined;
} {
  let hooks: OpenDocumentHooks | undefined;
  const client = {
    setOpenDocumentHooks(next: OpenDocumentHooks | undefined) {
      hooks = next;
    },
  } as unknown as AgentWorkerClient;
  return { client, hooks: () => hooks };
}

const remote = (markdown: string): DocumentChange => ({
  id: DOCUMENT.id,
  source: 'remote',
  tree: treeOf(markdown),
  markdown,
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a remote change in the open editor', () => {
  it('paints the merged tree without saving it', async () => {
    const { services, save } = stubServices({
      markdown: '# Title\n\nFirst paragraph.',
    });
    const { changes, emit } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');

    act(() => emit(remote('# Title\n\nSecond paragraph.')));
    await screen.findByText('Second paragraph.');
    expect(screen.queryByText('First paragraph.')).toBeNull();
    await pause(1_000);
    expect(save).not.toHaveBeenCalled();
  }, 10_000);

  it('drops a scheduled save the merge has made stale', async () => {
    const { services, save } = stubServices({
      markdown: '# Title\n\nFirst paragraph.',
    });
    const { changes, emit } = feed();
    const { client, hooks } = recordingClient();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <AgentProvider client={client}>
            <DocumentEditor document={DOCUMENT} />
          </AgentProvider>
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');

    // An edit that schedules a save, then the merge before it fires.
    act(() => {
      hooks()!.applyEdit(
        DOCUMENT.id,
        {
          state: markdownToState('# Title\n\nTyped here.').state,
        } as EditOutcome,
        false
      );
    });
    act(() => emit(remote('# Title\n\nMerged from afar.')));
    await screen.findByText('Merged from afar.');
    await pause(1_500);
    expect(save).not.toHaveBeenCalled();
  }, 10_000);

  it('keeps typing that lands after the merge', async () => {
    const { services, save } = stubServices({
      markdown: '# Title\n\nFirst paragraph.',
    });
    const { changes, emit } = feed();
    const { client, hooks } = recordingClient();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <AgentProvider client={client}>
            <DocumentEditor document={DOCUMENT} />
          </AgentProvider>
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');
    act(() => emit(remote('# Title\n\nMerged from afar.')));
    await screen.findByText('Merged from afar.');

    act(() => {
      hooks()!.applyEdit(
        DOCUMENT.id,
        {
          state: markdownToState('# Title\n\nMerged from afar. And more.')
            .state,
        } as EditOutcome,
        false
      );
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    });
    expect(save.mock.calls[0]![0].markdown).toContain(
      'Merged from afar. And more.'
    );
  }, 10_000);

  it('survives a merge that removes the paragraph holding the caret', async () => {
    const { services } = stubServices({
      markdown: '# Title\n\nFirst paragraph.',
    });
    const { changes, emit } = feed();
    const editors = createLiveEditors();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <LiveEditorsProvider value={editors}>
            <DocumentEditor document={DOCUMENT} />
          </LiveEditorsProvider>
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');
    const editor = editors.get(DOCUMENT.id)!.wrapper.editor;
    act(() => {
      editor.update(
        () => {
          ($getRoot().getLastChild() as ElementNode).selectEnd();
        },
        { discrete: true }
      );
    });

    act(() => emit(remote('# Other title\n\nOnly this now.')));
    await screen.findByText('Only this now.');
    expect(screen.queryByText('First paragraph.')).toBeNull();
    // The editor still takes edits after the paint.
    act(() => {
      editor.update(
        () => {
          ($getRoot().getLastChild() as ElementNode).selectEnd();
        },
        { discrete: true }
      );
    });
  }, 10_000);

  it('opens with the body when it arrives for a document still waiting for the server', async () => {
    const { services, save } = stubServices('awaiting');
    const { changes, emit } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByTestId('document-awaiting');
    expect(screen.queryByText('First paragraph.')).toBeNull();

    act(() => emit(remote('# Title\n\nFirst paragraph.')));
    await screen.findByText('First paragraph.');
    expect(screen.queryByTestId('document-awaiting')).toBeNull();
    await pause(500);
    expect(save).not.toHaveBeenCalled();
  }, 10_000);
});
