/**
 * The history panel's data, read from the app's ports.
 *
 * Kept apart from `HistoryPanel` so the view stays a pure function of the
 * versions it is handed: this is the only place that knows about the
 * composition root, and it is what a spec does NOT have to stand up.
 *
 * Three decisions live here rather than in the panel:
 *
 *  - the preview loads the version's TREE into a read-only editor, not its
 *    markdown. The tree is what the CRDT stores and what the live editor
 *    holds; going through markdown would re-parse what is already parsed and
 *    quietly lose whatever the markdown vocabulary cannot express.
 *  - restoring re-reads the document rather than pushing a tree into the live
 *    editor. Pushing is the agent's path and needs the agent's bridge, which a
 *    page with no assistant does not have; re-reading is the path every
 *    document open already takes. The repository's content cache is dropped
 *    first, or the re-read would hand back the tree from before the restore.
 *  - the restored state is marked as a version of its own, so the history
 *    grows by the restore instead of silently absorbing it, and the state the
 *    user restored is addressable again afterwards.
 */
import type { DocumentVersion, SerializedTree } from '@workspace/domain';
import { DocumentView, HistoryPanel } from '@workspace/workbench-editor';
import type { HistoryLabels } from '@workspace/workbench-editor';
import { useCallback, useEffect, useState } from 'react';
import {
  useDocuments,
  useDocumentVersions,
  useServices,
} from '../../composition/app-services';
import { useDocumentRevision } from '../document-revision';

/** How often the open panel re-reads the document's versions. */
const VERSION_POLL_MS = 5_000;

export function HistoryPanelContainer({
  documentId,
  labels,
}: {
  documentId: string;
  labels?: HistoryLabels;
}) {
  const versionStore = useDocumentVersions();
  const documents = useDocuments();
  const { identity, reportError } = useServices();
  const { reload } = useDocumentRevision();

  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selected, setSelected] = useState<{
    id: string;
    tree: SerializedTree | null;
  } | null>(null);

  const read = useCallback(
    () => versionStore.list(documentId),
    [versionStore, documentId]
  );

  /** Applies one read, reporting a failure rather than blanking the list. */
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof read>>) => {
      if (result.isErr()) {
        reportError(result.error);
        return;
      }
      setVersions(result.value);
    },
    [reportError]
  );

  useEffect(() => {
    void read().then(apply);
    // The version store is a plain reader — there is no watch on the port,
    // and adding one would mean changing the port and its adapter, which
    // this surface has no business doing. So the panel re-reads while it is
    // open: versions are marked by the editor after a pause in typing, and a
    // history that only showed what existed when the panel opened would be
    // wrong within one idle interval of being looked at. One indexed read of
    // a local table, only while the panel is on screen.
    const timer = setInterval(() => void read().then(apply), VERSION_POLL_MS);
    return () => clearInterval(timer);
  }, [read, apply]);

  const preview = useCallback(
    async (version: DocumentVersion) => {
      const result = await versionStore.readAt(documentId, version.ref);
      if (result.isErr()) {
        reportError(result.error);
        return;
      }
      // A null tree is not a failure: a CRDT version is not obliged to be a
      // structurally valid document, so the panel says it cannot be shown.
      setSelected({ id: version.id, tree: result.value });
    },
    [versionStore, documentId, reportError]
  );

  const restore = useCallback(
    async (version: DocumentVersion) => {
      const result = await versionStore.restore({
        documentId,
        ref: version.ref,
        author: { user: identity.userId, src: 'human' },
      });
      if (result.isErr()) {
        reportError(result.error);
        return;
      }
      documents.invalidate(documentId);
      await versionStore.mark({ documentId, kind: 'manual' });
      setSelected(null);
      apply(await read());
      reload();
    },
    [
      versionStore,
      documents,
      documentId,
      identity.userId,
      reportError,
      read,
      apply,
      reload,
    ]
  );

  return (
    <HistoryPanel
      versions={versions}
      selectedId={selected?.id ?? null}
      labels={labels}
      preview={
        selected ? (
          <VersionPreview
            key={selected.id}
            tree={selected.tree}
            unavailable={labels?.previewUnavailable}
          />
        ) : null
      }
      onPreview={(version) => void preview(version)}
      onRestore={(version) => void restore(version)}
    />
  );
}

/**
 * One past version, read-only.
 *
 * Keyed by the version outside, so selecting another one remounts the editor
 * rather than asking it to swap documents — the same reason the pane keys the
 * live editor by the document's identity.
 */
function VersionPreview({
  tree,
  unavailable,
}: {
  tree: SerializedTree | null;
  unavailable?: string;
}) {
  if (!tree)
    return (
      <p
        className="text-muted-foreground p-2 text-xs"
        data-testid="history-preview-unavailable"
      >
        {unavailable ?? 'This version cannot be previewed.'}
      </p>
    );
  return (
    <DocumentView
      readOnly
      namespace="document-version"
      initialTree={tree}
      className="min-h-0 flex-1"
      contentClassName="prose prose-neutral dark:prose-invert max-w-none text-sm"
    />
  );
}
