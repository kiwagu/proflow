import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilePane } from './file-pane.js';
import { FileSelectionProvider } from './file-selection.js';
import { FileServicesProvider, type FileServices } from './file-services.js';
import { FileViewer } from './file-viewer.js';
import { fakeServices, testNode } from './testing.js';

// jsdom has no object-URL plumbing; the viewer only needs a stable handle
// it can hand to an <img>/<a>, and the revoke is what the test watches.
const revoked: string[] = [];
let minted = 0;
URL.createObjectURL = () => `blob:test/${++minted}`;
URL.revokeObjectURL = (url: string) => {
  revoked.push(url);
};

function mount(
  services: FileServices,
  ui: React.ReactNode,
  openFileId?: string
) {
  return render(
    <FileServicesProvider services={services}>
      <FileSelectionProvider initialOpenFileId={openFileId}>
        {ui}
      </FileSelectionProvider>
    </FileServicesProvider>
  );
}

describe('the viewer over stored bytes', () => {
  it('renders an image inline, named and downloadable', async () => {
    const node = testNode({
      id: 'img',
      name: 'photo.png',
      mime: 'image/png',
      blobHash: 'h-img',
      size: 2_500_000,
    });
    const tree = fakeServices([node], {
      blobs: { 'h-img': new Blob(['bytes'], { type: 'image/png' }) },
    });
    mount(tree.services, <FileViewer node={node} />);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'photo.png' })).toBeTruthy()
    );
    expect(screen.getByTestId('file-viewer-name').textContent).toBe(
      'photo.png'
    );
    // The size is decimal, matching what the OS and the browser's own
    // storage panel report.
    expect(screen.getByText(/2\.5 MB/)).toBeTruthy();
    const download = screen.getByTestId('file-download') as HTMLAnchorElement;
    expect(download.getAttribute('download')).toBe('photo.png');
  });

  it('shows the head of a text file rather than offering a download', async () => {
    const node = testNode({
      id: 'txt',
      name: 'notes.md',
      mime: 'text/markdown',
      blobHash: 'h-txt',
    });
    const tree = fakeServices([node], {
      blobs: { 'h-txt': new Blob(['# Title'], { type: 'text/markdown' }) },
    });
    mount(tree.services, <FileViewer node={node} />);
    await waitFor(() =>
      expect(screen.getByTestId('file-viewer-text').textContent).toBe('# Title')
    );
  });

  it('offers a download when nothing can preview the type', async () => {
    const node = testNode({
      id: 'bin',
      name: 'firmware.bin',
      mime: 'application/octet-stream',
      blobHash: 'h-bin',
    });
    const tree = fakeServices([node], {
      blobs: { 'h-bin': new Blob(['\u0000']) },
    });
    mount(tree.services, <FileViewer node={node} />);
    await waitFor(() =>
      expect(screen.getByText('No preview for this file type.')).toBeTruthy()
    );
    expect(screen.getByText(/Download firmware\.bin/)).toBeTruthy();
  });

  it('hands an archive to the host instead of previewing it', async () => {
    const node = testNode({
      id: 'zip',
      name: 'course.zip',
      mime: 'application/zip',
      blobHash: 'h-zip',
    });
    const tree = fakeServices([node], {
      blobs: { 'h-zip': new Blob(['PK']) },
    });
    // An archive is not a file to look at but a package to run, and
    // running one is the host's surface.
    mount(
      tree.services,
      <FileViewer
        node={node}
        renderArchive={(n) => <div data-testid="archive-slot">{n.name}</div>}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('archive-slot').textContent).toBe('course.zip')
    );
  });

  it('says so plainly when the bytes are not on this device', async () => {
    // A node can arrive by sync long before its bytes do; the viewer must
    // not sit on "Loading…" forever in that case.
    const node = testNode({ id: 'absent', name: 'far.png', mime: 'image/png' });
    const tree = fakeServices([node], { blobs: {} });
    mount(tree.services, <FileViewer node={node} />);
    await waitFor(() =>
      expect(screen.getByTestId('file-viewer-status').textContent).toBe(
        'These bytes are not on this device.'
      )
    );
  });

  it('releases the object URL when it moves off the file', async () => {
    const node = testNode({
      id: 'img',
      name: 'photo.png',
      mime: 'image/png',
      blobHash: 'h-img',
    });
    const tree = fakeServices([node], {
      blobs: { 'h-img': new Blob(['bytes'], { type: 'image/png' }) },
    });
    const view = mount(tree.services, <FileViewer node={node} />);
    await waitFor(() => screen.getByRole('img', { name: 'photo.png' }));
    const before = revoked.length;
    view.unmount();
    // Without this a long session pins every file the user has opened.
    expect(revoked.length).toBe(before + 1);
  });
});

describe('the pane over the selection', () => {
  it('invites a selection when nothing is chosen', () => {
    mount(fakeServices([]).services, <FilePane />);
    expect(screen.getByTestId('pane-empty').textContent).toBe('Select a file.');
  });

  it('hands a document to the host editor with its identity and title', () => {
    const node = testNode({
      id: 'doc-node',
      kind: 'document',
      name: 'Meeting notes',
      documentId: 'doc-1',
      mime: null,
      blobHash: null,
    });
    const tree = fakeServices([node]);
    mount(
      tree.services,
      <FilePane
        renderDocument={(document) => (
          <div data-testid="editor">
            {document.id}:{document.title}
          </div>
        )}
      />,
      'doc-node'
    );
    expect(screen.getByTestId('editor').textContent).toBe(
      'doc-1:Meeting notes'
    );
  });

  it('summarises a folder and moves the selection on to what is inside', async () => {
    const tree = fakeServices([
      testNode({
        id: 'folder',
        kind: 'folder',
        name: 'Notes',
        mime: null,
        size: null,
        blobHash: null,
      }),
      testNode({
        id: 'child',
        name: 'inside.txt',
        parentId: 'folder',
        size: 1500,
      }),
    ]);
    mount(tree.services, <FilePane />, 'folder');
    const pane = screen.getByTestId('folder-pane');
    expect(pane.textContent).toContain('Notes');
    expect(pane.textContent).toContain('inside.txt');
    expect(pane.textContent).toContain('1.5 KB');

    screen.getByRole('button', { name: /inside\.txt/ }).click();
    await waitFor(() =>
      expect(screen.getByTestId('file-viewer-name').textContent).toBe(
        'inside.txt'
      )
    );
  });

  it('says an empty folder is empty rather than showing an empty list', () => {
    const tree = fakeServices([
      testNode({
        id: 'folder',
        kind: 'folder',
        name: 'Empty',
        mime: null,
        size: null,
        blobHash: null,
      }),
    ]);
    mount(tree.services, <FilePane />, 'folder');
    expect(screen.getByText('Empty folder.')).toBeTruthy();
  });
});
