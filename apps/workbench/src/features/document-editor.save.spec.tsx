/**
 * A save that does not go through is told to the user, and withdrawn once a
 * later attempt lands.
 *
 * The editor already retries a failed save by itself; what it owed the user
 * was the news. The failure is reported under one key per document, so the
 * retry loop replaces its notice instead of stacking one per second, and the
 * first success resolves that key.
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
import { act, render, screen, waitFor } from '../test-utils';
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

/** Ports whose first save is refused and whose second lands. */
function stubServices() {
  let saves = 0;
  const reportError = vi.fn();
  const resolveError = vi.fn();
  const services = {
    documents: {
      load: () =>
        Promise.resolve({
          isErr: () => false,
          value: {
            meta: DOCUMENT,
            content: { markdown: '# Title\n\nFirst paragraph.' },
          },
        }),
      save: () => {
        saves += 1;
        return Promise.resolve(
          saves === 1
            ? { isErr: () => true, error: 'the database is busy' }
            : { isErr: () => false, value: null }
        );
      },
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError,
    resolveError,
  } as unknown as AppServices;
  return { services, reportError, resolveError };
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

describe('a save that is refused', () => {
  it('is reported under the document’s key and withdrawn when the retry lands', async () => {
    const { client, hooks } = recordingClient();
    const { services, reportError, resolveError } = stubServices();
    render(
      <AppServicesProvider services={services}>
        <AgentProvider client={client}>
          <DocumentEditor document={DOCUMENT} />
        </AgentProvider>
      </AppServicesProvider>
    );
    await screen.findByText('First paragraph.');

    const next = markdownToState('# Title\n\nSecond paragraph.').state;
    act(() => {
      hooks()!.applyEdit(DOCUMENT.id, { state: next } as EditOutcome, false);
    });

    await waitFor(() => expect(reportError).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    });
    expect(reportError.mock.calls[0]).toEqual([
      { kind: 'save', title: 'Open document', reason: 'the database is busy' },
      { key: 'save:doc-open' },
    ]);
    expect(resolveError).not.toHaveBeenCalled();

    await waitFor(
      () => expect(resolveError).toHaveBeenCalledWith('save:doc-open'),
      {
        timeout: 4_000,
      }
    );
  }, 10_000);
});
