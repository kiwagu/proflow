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
  settle: (id: string) => void;
} {
  const listeners = new Set<(e: DocumentChange) => void>();
  const settledListeners = new Set<(id: string) => void>();
  return {
    changes: {
      onChanged(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      onSettled(listener) {
        settledListeners.add(listener);
        return () => {
          settledListeners.delete(listener);
        };
      },
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    settle: (id) => {
      for (const listener of settledListeners) listener(id);
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

  it('opens with the body when it lands while the awaiting answer is still on its way', async () => {
    const { services, save } = stubServices('awaiting');
    let answer: (value: unknown) => void = () => {};
    (services.documents as { load: unknown }).load = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const { changes, emit } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    // The load read the document before the body landed, and answers after.
    act(() => emit(remote('# Title\n\nFirst paragraph.')));
    act(() =>
      answer({
        isErr: () => false,
        value: { meta: DOCUMENT, content: null, awaitingSync: true },
      })
    );
    await screen.findByText('First paragraph.');
    expect(screen.queryByTestId('document-awaiting')).toBeNull();
    await pause(500);
    expect(save).not.toHaveBeenCalled();
  }, 10_000);

  it('shows a body that lands while the editor is still mounting on an older one', async () => {
    const { services, save } = stubServices({
      markdown: '# Title\n\nOld body.',
    });
    let answer: (value: unknown) => void = () => {};
    (services.documents as { load: unknown }).load = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const { changes, emit } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    // The load answers with what it read; the merge lands before the editor
    // it is about to mount has handed over its instance.
    await act(async () => {
      answer({
        isErr: () => false,
        value: {
          meta: DOCUMENT,
          content: { markdown: '# Title\n\nOld body.' },
        },
      });
      await Promise.resolve();
      emit(remote('# Title\n\nRemote body.'));
    });
    await screen.findByText('Remote body.');
    expect(screen.queryByText('Old body.')).toBeNull();
    await pause(500);
    expect(save).not.toHaveBeenCalled();
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

  /**
   * The first pull of a document the graph brought in found nothing on the
   * server — its body is simply empty, nobody has typed in it yet. No merge
   * happens, so nothing arrives; the pane would wait for ever. The store
   * says the wait is over, and the pane asks again.
   */
  it('leaves the wait when the first pull finds nothing on the server', async () => {
    const waiting = {
      isErr: () => false,
      value: { meta: DOCUMENT, content: null, awaitingSync: true },
    };
    const settled = {
      isErr: () => false,
      value: { meta: DOCUMENT, content: null, awaitingSync: false },
    };
    const load = vi
      .fn()
      .mockResolvedValueOnce(waiting)
      .mockResolvedValue(settled);
    const { services } = stubServices('awaiting');
    (services.documents as unknown as { load: typeof load }).load = load;
    const { changes, settle } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByTestId('document-awaiting');

    act(() => settle(DOCUMENT.id));
    await waitFor(() =>
      expect(screen.queryByTestId('document-awaiting')).toBeNull()
    );
    expect(load).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('asks again when the wait ended while the first answer was still on its way', async () => {
    let answerStale: (value: unknown) => void = () => {};
    const stale = new Promise((resolve) => {
      answerStale = resolve;
    });
    const settled = {
      isErr: () => false,
      value: { meta: DOCUMENT, content: null, awaitingSync: false },
    };
    const load = vi.fn().mockReturnValueOnce(stale).mockResolvedValue(settled);
    const { services } = stubServices('awaiting');
    (services.documents as unknown as { load: typeof load }).load = load;
    const { changes, settle } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );

    // The pull finished and said so before the first read answered; that
    // read began before the pull and still says "waiting".
    act(() => settle(DOCUMENT.id));
    await act(async () => {
      answerStale({
        isErr: () => false,
        value: { meta: DOCUMENT, content: null, awaitingSync: true },
      });
      await Promise.resolve();
    });

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId('document-awaiting')).toBeNull()
    );
  }, 10_000);

  it('does not reread a document that is already open', async () => {
    const { services } = stubServices({ markdown: 'Open body.' });
    const load = vi.spyOn(services.documents, 'load');
    const { changes, settle } = feed();
    render(
      <AppServicesProvider services={services}>
        <DocumentChangesProvider value={changes}>
          <DocumentEditor document={DOCUMENT} />
        </DocumentChangesProvider>
      </AppServicesProvider>
    );
    await screen.findByText('Open body.');
    const calls = load.mock.calls.length;

    act(() => settle(DOCUMENT.id));
    await pause(300);
    expect(load.mock.calls.length).toBe(calls);
    expect(screen.getByText('Open body.')).toBeTruthy();
  }, 10_000);
});
