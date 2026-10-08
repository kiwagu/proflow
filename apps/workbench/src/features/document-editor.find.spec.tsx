/**
 * Find & replace inside the open editor.
 *
 * The panel itself is the library's; what the pane owns is WHEN it is on
 * screen: the shortcut that opens it has to fire from inside the editor
 * (the one place the registry otherwise yields to typing), closing it has
 * to hand focus back, and opening another document has to forget the
 * search rather than carry it over.
 */
import type { DocumentMeta } from '@workspace/domain';
import { liveHotkeyCount } from '@workspace/ui/hooks/use-hotkey';
import { $createTextNode, $getRoot, $isElementNode } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { AppServicesProvider } from '../composition/app-services';
import type { AppServices } from '../composition/services';
import { act, fireEvent, render, screen, waitFor } from '../test-utils';
import { DocumentEditor } from './document-editor';
import {
  LiveDocumentsProvider,
  useLiveDocuments,
  type LiveDocuments,
} from './live-documents';
import { createLiveEditors, LiveEditorsProvider } from './live-editor';

/** Hands the registry the provider built out to the test. */
function Probe({ onLive }: { onLive: (live: LiveDocuments) => void }) {
  onLive(useLiveDocuments());
  return null;
}

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
  'doc-a': '# Title\n\nFirst paragraph.',
  'doc-b': '# Other\n\nSecond body.',
};

function stubServices() {
  const save = vi.fn((_input: unknown) =>
    Promise.resolve({ isErr: () => false, value: null })
  );
  const services = {
    documents: {
      load: (id: string) =>
        Promise.resolve({
          isErr: () => false,
          value: { meta: meta(id), content: { markdown: BODIES[id] } },
        }),
      save,
    },
    documentVersions: { mark: () => Promise.resolve({ isErr: () => false }) },
    identity: { userId: 'user-1', spaceId: 'space-1' },
    reportError: () => {},
  } as unknown as AppServices;
  return { services, save };
}

function view(documentId: string, services = stubServices().services) {
  return (
    <AppServicesProvider services={services}>
      <DocumentEditor document={meta(documentId)} />
    </AppServicesProvider>
  );
}

const settle = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** Types a query into the open panel and waits for the highlights. */
async function search(query: string) {
  fireEvent.change(screen.getByPlaceholderText('Find…'), {
    target: { value: query },
  });
  await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy());
}

/** The editable, marked as the browser would so the registry sees typing. */
async function openedEditable(): Promise<HTMLElement> {
  await screen.findByText('First paragraph.');
  const editable = document.querySelector<HTMLElement>(
    '[contenteditable="true"]'
  );
  if (!editable) throw new Error('no editable');
  Object.defineProperty(editable, 'isContentEditable', { value: true });
  return editable;
}

describe('find and replace in the open editor', () => {
  it('opens on the shortcut even while the keystroke comes from the editor', async () => {
    render(view('doc-a'));
    const editable = await openedEditable();
    expect(screen.queryByRole('search')).toBeNull();

    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });

    const panel = screen.getByRole('search');
    expect(panel).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Find…'));
  });

  it('binds its shortcut through the registry for exactly the life of the editor', async () => {
    const before = liveHotkeyCount();
    const { unmount } = render(view('doc-a'));
    await openedEditable();
    expect(liveHotkeyCount()).toBe(before + 1);
    unmount();
    expect(liveHotkeyCount()).toBe(before);
  });

  it('closes on Escape and hands focus back to the editor', async () => {
    render(view('doc-a'));
    const editable = await openedEditable();
    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });
    const input = screen.getByPlaceholderText('Find…');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('search')).toBeNull();
    expect(document.activeElement).toBe(editable);
  });

  it('forgets the search when another document opens', async () => {
    const { rerender } = render(view('doc-a'));
    const editable = await openedEditable();
    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });
    await search('First');

    rerender(view('doc-b'));
    await screen.findByText('Second body.');

    expect(screen.queryByRole('search')).toBeNull();
    // Reopening starts empty: no query, no highlight carried over.
    fireEvent.keyDown(
      document.querySelector<HTMLElement>('[contenteditable="true"]')!,
      { key: 'f', ctrlKey: true }
    );
    expect(
      (screen.getByPlaceholderText('Find…') as HTMLInputElement).value
    ).toBe('');
    expect(document.querySelector('mark')).toBeNull();
  });

  it('brings the shortcut back to the search field when the panel is already open', async () => {
    render(view('doc-a'));
    const editable = await openedEditable();
    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });
    const input = screen.getByPlaceholderText('Find…');
    expect(document.activeElement).toBe(input);

    editable.focus();
    expect(document.activeElement).toBe(editable);
    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });

    expect(document.activeElement).toBe(input);
  });

  it('never saves the document for a search alone', async () => {
    const { services, save } = stubServices();
    render(view('doc-a', services));
    const editable = await openedEditable();
    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });
    await search('First');
    expect(document.querySelector('mark')).not.toBeNull();

    // Past the save debounce: nothing was written, there was nothing to write.
    await settle(700);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the highlights out of what a real edit saves', async () => {
    const { services, save } = stubServices();
    const live = createLiveEditors();
    let documents!: LiveDocuments;
    render(
      <AppServicesProvider services={services}>
        <LiveEditorsProvider value={live}>
          <LiveDocumentsProvider>
            <Probe onLive={(value) => (documents = value)} />
            <DocumentEditor document={meta('doc-a')} />
          </LiveDocumentsProvider>
        </LiveEditorsProvider>
      </AppServicesProvider>
    );
    const editable = await openedEditable();
    fireEvent.keyDown(editable, { key: 'f', ctrlKey: true });
    await search('First');

    // A genuine edit while the highlights are up, in the editor itself.
    const editor = live.get('doc-a')!.wrapper.editor;
    act(() => {
      editor.update(
        () => {
          const last = $getRoot().getLastChild();
          if ($isElementNode(last)) last.append($createTextNode(' Edited.'));
        },
        { discrete: true }
      );
    });
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3_000 });

    const written = JSON.stringify(save.mock.calls[0]?.[0]);
    expect(written).toContain('First paragraph. Edited.');
    expect(written).not.toContain('"mark"');
    expect(written).not.toContain('find-match');
    // What the surfaces outside the pane read (an export) is as clean.
    expect(JSON.stringify(documents.read('doc-a'))).not.toContain('find-match');
  });

  it('replaces in the live document, not in a copy', async () => {
    render(view('doc-a'));
    const editable = await openedEditable();
    fireEvent.click(screen.getByTestId('find-replace-trigger'));

    fireEvent.change(screen.getByPlaceholderText('Find…'), {
      target: { value: 'First' },
    });
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('Replace with…'), {
      target: { value: 'Third' },
    });
    fireEvent.click(screen.getByLabelText('Replace all'));

    await waitFor(() =>
      expect(editable.textContent).toContain('Third paragraph.')
    );
    expect(editable.textContent).not.toContain('First paragraph.');
  });
});
