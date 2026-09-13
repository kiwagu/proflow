/**
 * The editor pane, as the agent reaches it through the app's own tree.
 *
 * The seam between them is registered by a hook that does nothing when no
 * provider is mounted, so a bridge that works in isolation can still be
 * silent in the running app. These cases mount the product's editor under
 * the composition the app actually builds and ask the agent's side of the
 * seam what it can see.
 */
import type { DocumentMeta } from '@workspace/domain';
import type { AgentWorkerClient, OpenDocumentHooks } from '@workspace/ai-agent';
import { AgentProvider } from '@workspace/workbench-agent';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../composition/app-services';
import type { AppServices } from '../composition/services';
import { render, screen } from '../test-utils';
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

const MARKDOWN = '# Title\n\nFirst paragraph.';

/** Just enough of the app's ports for one document to open and save. */
function stubServices(): AppServices {
  return {
    documents: {
      load: () =>
        Promise.resolve({
          isErr: () => false,
          value: { meta: DOCUMENT, content: { markdown: MARKDOWN } },
        }),
      save: () => Promise.resolve({ isErr: () => false, value: null }),
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError: () => {},
  } as unknown as AppServices;
}

/** A client that only records what the provider registers on it. */
function recordingClient(): {
  client: AgentWorkerClient;
  hooks: () => OpenDocumentHooks | undefined;
  registrations: () => number;
} {
  let hooks: OpenDocumentHooks | undefined;
  let registrations = 0;
  const client = {
    setOpenDocumentHooks(next: OpenDocumentHooks | undefined) {
      hooks = next;
      if (next) registrations++;
    },
  } as unknown as AgentWorkerClient;
  return { client, hooks: () => hooks, registrations: () => registrations };
}

function mount(view: ReactNode) {
  return render(
    <AppServicesProvider services={stubServices()}>{view}</AppServicesProvider>
  );
}

async function openedEditor(): Promise<void> {
  await screen.findByText('First paragraph.');
}

describe('the editor pane under the app composition', () => {
  it('registers its bridge with the agent when the provider is mounted', async () => {
    const { client, hooks } = recordingClient();
    mount(
      <AgentProvider client={client}>
        <DocumentEditor document={DOCUMENT} />
      </AgentProvider>
    );
    await openedEditor();

    // The agent asking what the open document holds is the whole point of
    // the mount: an unregistered bridge answers `null` and sends every
    // agent edit through storage instead of the user's editor.
    const state = hooks()?.readState(DOCUMENT.id);
    expect(state).toBeDefined();
    expect(state).not.toBeNull();
    expect(JSON.stringify(state)).toContain('First paragraph.');
  });

  it('opens the document just the same with no agent on the page', async () => {
    // A page with no worker — no model provider, an environment without
    // workers — is a working editor, not a broken one.
    mount(<DocumentEditor document={DOCUMENT} />);
    await openedEditor();
    expect(screen.getByTestId('save-state')).toBeDefined();
  });

  it('registers once per mounted provider and releases on unmount', async () => {
    const { client, hooks, registrations } = recordingClient();
    const view = (
      <AgentProvider client={client}>
        <DocumentEditor document={DOCUMENT} />
      </AgentProvider>
    );
    const { rerender, unmount } = mount(view);
    await openedEditor();
    expect(registrations()).toBe(1);

    // Re-rendering the tree must not stack a second registration — the
    // client is the page's one worker, handed in rather than created here.
    rerender(
      <AppServicesProvider services={stubServices()}>
        {view}
      </AppServicesProvider>
    );
    await openedEditor();
    expect(registrations()).toBe(1);

    unmount();
    expect(hooks()).toBeUndefined();
  });

  it('never constructs a worker of its own', async () => {
    // The provider takes a client; the page starts the one worker. A
    // provider that started its own would give every remount another
    // WebAssembly Postgres.
    const constructed = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          constructed();
        }
      }
    );
    const { client } = recordingClient();
    mount(
      <AgentProvider client={client}>
        <DocumentEditor document={DOCUMENT} />
      </AgentProvider>
    );
    await openedEditor();
    expect(constructed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
