/**
 * The outline in the aside, over the editor the pane has open.
 *
 * The panel is a sibling of the editor, so it reaches the editor through the
 * live-editor registry rather than through the editor's own context. What
 * these cases pin down is that it always shows the OPEN document's headings:
 * switching documents switches the outline, and with no editor on screen it
 * says so instead of showing the last one.
 */
import type { DocumentMeta } from '@workspace/domain';
import { describe, expect, it } from 'vitest';
import { AppServicesProvider } from '../../composition/app-services';
import type { AppServices } from '../../composition/services';
import { render, screen } from '../../test-utils';
import { DocumentEditor } from '../document-editor';
import { LiveEditorsProvider } from '../live-editor';
import { OutlinePanelContainer } from './outline.container';

const meta = (id: string): DocumentMeta => ({
  id,
  title: id,
  kind: 'md',
  preview: '',
  starred: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const BODIES: Record<string, string> = {
  'doc-a': '# One\n\n## Two\n\n## Three\n\nBody A.',
  'doc-b': '# Alpha\n\n## Beta\n\n## Gamma\n\nBody B.',
  'doc-short': '# Only\n\nBody.',
};

function stubServices(): AppServices {
  return {
    documents: {
      load: (id: string) =>
        Promise.resolve({
          isErr: () => false,
          value: { meta: meta(id), content: { markdown: BODIES[id] } },
        }),
      save: () => Promise.resolve({ isErr: () => false, value: null }),
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError: () => {},
  } as unknown as AppServices;
}

const LABELS = {
  title: 'Outline',
  ariaLabel: 'Document outline',
  toggle: 'Outline',
  empty: 'No headings yet.',
  nav: 'Document outline',
};

function view(documentId: string) {
  return (
    <AppServicesProvider services={stubServices()}>
      <LiveEditorsProvider>
        <DocumentEditor document={meta(documentId)} />
        <OutlinePanelContainer documentId={documentId} labels={LABELS} />
      </LiveEditorsProvider>
    </AppServicesProvider>
  );
}

describe('the outline panel over the open editor', () => {
  it('lists the open document’s headings and follows a switch to another document', async () => {
    const { rerender } = render(view('doc-a'));
    await screen.findByText('Body A.');
    expect(await screen.findByLabelText('Two')).toBeTruthy();
    expect(screen.getByLabelText('Three')).toBeTruthy();

    rerender(view('doc-b'));
    await screen.findByText('Body B.');
    expect(await screen.findByLabelText('Beta')).toBeTruthy();
    expect(screen.queryByLabelText('Two')).toBeNull();
  });

  it('says there is nothing to outline when the document has too few headings', async () => {
    render(view('doc-short'));
    await screen.findByText('Body.');
    expect(await screen.findByTestId('outline-empty')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('says so when no editor is on screen for the document', () => {
    render(
      <LiveEditorsProvider>
        <OutlinePanelContainer documentId="doc-none" labels={LABELS} />
      </LiveEditorsProvider>
    );
    expect(screen.getByTestId('outline-empty')).toBeTruthy();
  });
});
