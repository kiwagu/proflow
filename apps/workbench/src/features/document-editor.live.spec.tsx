/**
 * The editor announcing what it holds, for the surfaces that act on the
 * open document from outside it.
 *
 * The subject is freshness: an export taken while a save is still in flight
 * must see the keystrokes the port has not received yet. So the save here
 * never completes, an edit is pushed through the agent's bridge — the one
 * path that changes the live editor without a keyboard — and the registry is
 * asked what the document says now.
 */
import type { DocumentMeta } from '@workspace/domain';
import type {
  AgentWorkerClient,
  EditOutcome,
  OpenDocumentHooks,
} from '@workspace/ai-agent';
import { markdownToState } from '@workspace/lexical-nodes/utils';
import { AgentProvider } from '@workspace/workbench-agent';
import { describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../composition/app-services';
import type { AppServices } from '../composition/services';
import { act, render, screen } from '../test-utils';
import { DocumentEditor } from './document-editor';
import {
  LiveDocumentsProvider,
  useLiveDocuments,
  type LiveDocuments,
} from './live-documents';

const DOCUMENT: DocumentMeta = {
  id: 'doc-open',
  title: 'Open document',
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** Ports for one document whose saves start but never land. */
function stubServices(): AppServices & { save: ReturnType<typeof vi.fn> } {
  const save = vi.fn(() => new Promise(() => {}));
  return {
    save,
    documents: {
      load: () =>
        Promise.resolve({
          isErr: () => false,
          value: {
            meta: DOCUMENT,
            content: { markdown: '# Title\n\nFirst paragraph.' },
          },
        }),
      save,
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError: () => {},
  } as unknown as AppServices & { save: ReturnType<typeof vi.fn> };
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

/** Hands the registry the provider built out to the test. */
function Probe({ onLive }: { onLive: (live: LiveDocuments) => void }) {
  onLive(useLiveDocuments());
  return null;
}

const said = (live: LiveDocuments) => JSON.stringify(live.read(DOCUMENT.id));

describe('the open document as the registry sees it', () => {
  it('answers with what the editor holds while its save is still in flight', async () => {
    let live!: LiveDocuments;
    const { client, hooks } = recordingClient();
    const services = stubServices();
    render(
      <AppServicesProvider services={services}>
        <LiveDocumentsProvider>
          <Probe onLive={(value) => (live = value)} />
          <AgentProvider client={client}>
            <DocumentEditor document={DOCUMENT} />
          </AgentProvider>
        </LiveDocumentsProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');
    expect(said(live)).toContain('First paragraph.');

    const next = markdownToState('# Title\n\nSecond paragraph.').state;
    act(() => {
      hooks()!.applyEdit(DOCUMENT.id, { state: next } as EditOutcome, false);
    });

    // The registry already says the new text before any save was even
    // scheduled…
    expect(said(live)).toContain('Second paragraph.');
    expect(said(live)).not.toContain('First paragraph.');

    // …and still says it once the debounced save has STARTED and hangs: this
    // is the window the port cannot see into. Reading the registry is not a
    // write, so no further save is scheduled by the asking.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(services.save).toHaveBeenCalledTimes(1);
    said(live);
    said(live);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(services.save).toHaveBeenCalledTimes(1);
    expect(said(live)).toContain('Second paragraph.');
  });

  it('forgets the document when its editor unmounts', async () => {
    let live!: LiveDocuments;
    const view = render(
      <AppServicesProvider services={stubServices()}>
        <LiveDocumentsProvider>
          <Probe onLive={(value) => (live = value)} />
          <DocumentEditor document={DOCUMENT} />
        </LiveDocumentsProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');
    expect(live.read(DOCUMENT.id)).not.toBeNull();

    view.unmount();
    expect(live.read(DOCUMENT.id)).toBeNull();
  });
});
