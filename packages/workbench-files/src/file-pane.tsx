'use client';

import type { DocumentMeta, FileNode } from '@workspace/domain';
import { cn } from '@workspace/ui/lib/utils';
import { useMemo, type ReactNode } from 'react';
import { FileIcon } from './file-icon.js';
import { useFileNodes, useFileSelection } from './file-selection.js';
import { formatSize } from './file-tree.js';
import { FileViewer } from './file-viewer.js';

/**
 * The main pane renders the selected file node: the editor for a native
 * document, a viewer for an imported file, a summary for a folder.
 *
 * The editor itself is the host's — the pane hands it the document's
 * identity and title and asks for a surface back, so the files package
 * carries no editor dependency.
 */
export function FilePane({
  renderDocument,
  renderArchive,
  emptyLabel = 'Select a file.',
  className,
}: {
  renderDocument?: (document: DocumentMeta) => ReactNode;
  renderArchive?: (node: FileNode) => ReactNode;
  emptyLabel?: string;
  className?: string;
}) {
  const { openFileId } = useFileSelection();
  const nodes = useFileNodes();
  const selected = nodes.find((n) => n.id === openFileId);

  // The editor needs the document's identity and title, and the file node
  // already carries both — a document node's name IS its title. Building
  // the meta here instead of loading the document keeps a switch off the
  // database's queue entirely; the editor loads the content itself.
  //
  // Stable per document, deliberately: the tree is a live query that
  // refreshes on every save, and a fresh meta object each time would
  // remount the editor someone is typing in. Only the identity changing
  // is allowed to rebuild it.
  const documentId = selected?.documentId ?? null;
  const name = selected?.name;
  const document = useMemo(
    () =>
      documentId
        ? ({
            id: documentId,
            title: name ?? '',
            kind: 'md',
            preview: '',
            starred: false,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          } satisfies DocumentMeta)
        : undefined,
    // The title is read at identity time only; a rename refreshes the row
    // it is shown in, not the editor it is open in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentId]
  );

  const children = useMemo(
    () => (selected ? nodes.filter((n) => n.parentId === selected.id) : []),
    [selected, nodes]
  );

  if (selected?.kind === 'document')
    return document && renderDocument ? (
      <div
        className={cn('h-full min-h-0', className)}
        data-testid="document-pane"
      >
        {renderDocument(document)}
      </div>
    ) : (
      <p className="p-6 text-muted-foreground" data-testid="pane-empty">
        Opening…
      </p>
    );

  if (selected?.kind === 'blob')
    return (
      <FileViewer
        node={selected}
        renderArchive={renderArchive}
        className={className}
      />
    );

  if (selected?.kind === 'folder')
    return (
      <FolderPane folder={selected} contents={children} className={className} />
    );

  return (
    <p className="p-6 text-muted-foreground" data-testid="pane-empty">
      {emptyLabel}
    </p>
  );
}

function FolderPane({
  folder,
  contents,
  className,
}: {
  folder: FileNode;
  contents: FileNode[];
  className?: string;
}) {
  const { setOpenFileId } = useFileSelection();
  return (
    <div
      className={cn('flex flex-col gap-4 p-6', className)}
      data-testid="folder-pane"
    >
      <div className="flex items-center gap-2">
        <FileIcon node={folder} className="size-6" />
        <h2 className="text-lg font-medium">{folder.name}</h2>
      </div>
      <ul className="flex flex-col gap-1">
        {contents.length === 0 ? (
          <li className="text-sm text-muted-foreground">Empty folder.</li>
        ) : null}
        {contents.map((child) => (
          <li key={child.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
              onClick={() => setOpenFileId(child.id)}
            >
              <FileIcon node={child} />
              <span className="min-w-0 flex-1 truncate">{child.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatSize(child.size)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
