import type {
  DocumentMeta,
  EditAuthor,
  SerializedTree,
} from '@workspace/domain';
import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import {
  createWorkbenchTranslator,
  loadWorkbenchMessages,
} from '@workspace/i18n-catalogs/workbench';
import type { LexicalWrapper } from '@workspace/lexical-react';
import { editorStateAsMarkdown } from '@workspace/lexical-react/utils';
import {
  buildFormatToolsLabels,
  buildTableInsertLabels,
  DocumentView,
  FormatTools,
  TableInsert,
} from '@workspace/workbench-editor';
import type { SerializedEditorState } from 'lexical';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useDocuments,
  useDocumentVersions,
  useServices,
} from '../composition/app-services';
import { Spinner } from '../shell/boot-shell';

/** Keystrokes settle for this long before the document is written. */
const SAVE_DEBOUNCE_MS = 400;
/** A pause this long after the last save marks an "idle" version. */
const VERSION_DEBOUNCE_MS = 30_000;

/**
 * Loads the workbench catalog once for the app's locale and hands back a
 * translator — the seam every editor chrome surface (toolbar, table
 * picker) reads its labels through. `null` while the catalog is loading.
 */
function useWorkbenchTranslator(): WorkbenchTranslator | null {
  const [t, setT] = useState<WorkbenchTranslator | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The app has no locale switcher yet; English is the only wired
    // locale until one is added — the catalog itself already has ES.
    void loadWorkbenchMessages('en').then((messages) => {
      if (!cancelled) setT(() => createWorkbenchTranslator(messages));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return t;
}

/**
 * A document in the editor: loads it once, mounts the editing shell over
 * its markdown, and writes every settled change back through the document
 * port. One editor is open at a time, keyed by the document's identity —
 * a switch remounts this whole surface with the next document's content.
 */
export function DocumentEditor({ document }: { document: DocumentMeta }) {
  // Keyed by identity: a switch remounts the surface below with fresh state,
  // so no effect has to reset anything when the document changes.
  return <OpenDocument key={document.id} document={document} />;
}

function OpenDocument({ document }: { document: DocumentMeta }) {
  const documents = useDocuments();
  const versions = useDocumentVersions();
  const { identity } = useServices();
  const t = useWorkbenchTranslator();
  const formatToolsLabels = useMemo(
    () => (t ? buildFormatToolsLabels(t) : undefined),
    [t]
  );
  const tableInsertLabels = useMemo(
    () => (t ? buildTableInsertLabels(t) : undefined),
    [t]
  );
  const [initial, setInitial] = useState<
    { markdown: string } | { error: string } | null
  >(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    let cancelled = false;
    void documents.load(document.id).then((result) => {
      if (cancelled) return;
      if (result.isErr()) setInitial({ error: result.error });
      else setInitial({ markdown: result.value.content?.markdown ?? '' });
    });
    return () => {
      cancelled = true;
    };
  }, [documents, document.id]);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const versionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** What the debounced save would write, so unmounting can write it NOW. */
  const unsaved = useRef<{ tree: SerializedTree; markdown: string }>(undefined);

  // The save routine is reached through a ref: its retry and the unmount
  // flush call it from timers and cleanups that outlive any one render, and
  // must still write through the latest ports.
  const persistRef = useRef<(tree: SerializedTree, markdown: string) => void>(
    () => {}
  );
  const persist = useCallback(
    (tree: SerializedTree, markdown: string) =>
      persistRef.current(tree, markdown),
    []
  );

  useEffect(() => {
    const author: EditAuthor = { user: identity.userId, src: 'human' };
    persistRef.current = async (tree, markdown) => {
      setSaved('saving');
      unsaved.current = undefined;
      const result = await documents.save({
        id: document.id,
        tree,
        markdown,
        preview: markdown.slice(0, 200),
        author,
      });
      if (result.isErr()) {
        // Not saved: say so, and try again — the usual cause is the database
        // re-electing a leader after another tab closed, which passes.
        console.error(result.error);
        setSaved('idle');
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persist(tree, markdown), 1000);
        return;
      }
      setSaved('saved');
      // Nothing changed: no write happened, so there is no new state to mark.
      if (!result.value) return;
      clearTimeout(versionTimer.current);
      versionTimer.current = setTimeout(() => {
        void versions.mark({ documentId: document.id, kind: 'idle' });
      }, VERSION_DEBOUNCE_MS);
    };
  }, [documents, versions, document.id, identity.userId, persist]);

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      clearTimeout(versionTimer.current);
      // Switching away inside the debounce window must not discard the last
      // keystrokes: flush them instead of dropping the timer's work.
      const held = unsaved.current;
      if (held) {
        unsaved.current = undefined;
        persist(held.tree, held.markdown);
      }
    },
    [persist]
  );

  /**
   * An editor reports what it was given back as a change: mounting it
   * normalizes the content and that normalization arrives here looking
   * exactly like typing. Only a change after the first user edit is saved,
   * so a tab that merely OPENED a document never writes to it.
   */
  const edited = useRef(false);
  const onWrapper = useCallback(
    (wrapper: LexicalWrapper) => {
      edited.current = false;
      const unregister = wrapper.editor.registerUpdateListener(
        ({ editorState, dirtyElements, dirtyLeaves, tags }) => {
          if (tags.has('history-merge') && !edited.current) return;
          if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
          edited.current = true;
          const tree = editorState.toJSON() as SerializedEditorState as
            SerializedTree | undefined;
          if (!tree) return;
          const markdown = editorStateAsMarkdown(editorState);
          unsaved.current = { tree, markdown };
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(
            () => void persist(tree, markdown),
            SAVE_DEBOUNCE_MS
          );
        }
      );
      // The wrapper's own cleanup runs on unmount; chain ours onto it.
      const cleanup = wrapper.cleanup;
      wrapper.cleanup = () => {
        unregister();
        cleanup();
      };
    },
    [persist]
  );

  if (!initial)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Spinner className="animate-spin" /> Opening…
      </div>
    );
  if ('error' in initial)
    return (
      <p className="text-destructive p-6 text-sm">
        Could not open the document: {initial.error}
      </p>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocumentView
        key={document.id}
        namespace={`document:${document.id}`}
        initialMarkdown={initial.markdown}
        onWrapper={onWrapper}
        className="min-h-0 flex-1"
        contentClassName="prose prose-neutral dark:prose-invert max-w-3xl"
      >
        {/* Children mount after the editable in the DOM; the toolbar belongs
            above it, and the shell's column flex lets order say so. */}
        <div className="order-first flex items-center gap-2 border-b px-2 py-1">
          <FormatTools className="flex-1" labels={formatToolsLabels}>
            <TableInsert labels={tableInsertLabels} />
          </FormatTools>
          <span
            className="text-muted-foreground shrink-0 text-xs"
            data-testid="save-state"
          >
            {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}
          </span>
        </div>
      </DocumentView>
    </div>
  );
}
