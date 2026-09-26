import type {
  DocumentMeta,
  EditAuthor,
  SerializedTree,
} from '@workspace/domain';
import {
  isWrapperWithIds,
  type LexicalWrapper,
} from '@workspace/lexical-react';
import { editorStateAsMarkdown } from '@workspace/lexical-react/utils';
import { useEditorBridge } from '@workspace/workbench-agent';
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
import { useWorkbenchTranslator } from '../i18n';
import { Spinner } from '../shell/boot-shell';
import { createAgentSeam } from './document-editor.agent-state';
import { useDocumentRevision } from './document-revision';
import { useLiveDocuments } from './live-documents';

/** Keystrokes settle for this long before the document is written. */
const SAVE_DEBOUNCE_MS = 400;
/** A pause this long after the last save marks an "idle" version. */
const VERSION_DEBOUNCE_MS = 30_000;

/**
 * A document in the editor: loads it once, mounts the editing shell over
 * its markdown, and writes every settled change back through the document
 * port. One editor is open at a time, keyed by the document's identity —
 * a switch remounts this whole surface with the next document's content.
 */
export function DocumentEditor({ document }: { document: DocumentMeta }) {
  // Keyed by identity: a switch remounts the surface below with fresh state,
  // so no effect has to reset anything when the document changes. The
  // revision joins the key because a restore rewrote the stored document
  // under a surface that owns its content after mount — remounting is how
  // the editor reads it again without an agent bridge to push a tree through.
  const { revision } = useDocumentRevision();
  return (
    <OpenDocument key={`${document.id}:${revision}`} document={document} />
  );
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
    { tree?: SerializedTree; markdown: string } | { error: string } | null
  >(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    let cancelled = false;
    void documents.load(document.id).then((result) => {
      if (cancelled) return;
      if (result.isErr()) setInitial({ error: result.error });
      else
        // Both, and the view prefers the tree: the stored pair can disagree
        // after a restore, which rewrites the canonical tree and leaves the
        // derived markdown as it was. The tree is what the document is.
        setInitial({
          tree: result.value.content?.tree,
          markdown: result.value.content?.markdown ?? '',
        });
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
  /**
   * The live editor, for the agent, and the bridge answering from it.
   *
   * The slot is created and read entirely outside React — the agent asks
   * from a worker message, with no component around — so it is deliberately
   * not a ref, matching how the editor mount holds its own live values. The
   * bridge reads it per call rather than capturing: the agent asks about a
   * document, and by the time it asks this surface may hold another one or
   * none at all.
   */
  const [agent] = useState(createAgentSeam);
  useEditorBridge(agent.bridge);
  // The surfaces that act on this document from outside (an export from the
  // explorer's menu or the palette) ask the registry, and the registry asks
  // the editor — a plain serialization at the moment of asking, never a
  // write, so the answer is fresher than anything the port has been told.
  const live = useLiveDocuments();
  const onWrapper = useCallback(
    (wrapper: LexicalWrapper) => {
      edited.current = false;
      const release = live.register(
        document.id,
        () =>
          wrapper.editor.getEditorState().toJSON() as unknown as SerializedTree
      );
      if (isWrapperWithIds(wrapper)) {
        agent.setLive({
          documentId: document.id,
          editor: wrapper.editor,
          mapping: wrapper.mapping,
        });
      }
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
        agent.setLive(null);
        release();
        unregister();
        cleanup();
      };
    },
    [persist, document.id, agent, live]
  );

  if (!initial)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Spinner className="animate-spin" />{' '}
        {t ? t('workbench.app.opening') : 'Opening…'}
      </div>
    );
  if ('error' in initial)
    return (
      <p className="text-destructive p-6 text-sm">
        {t
          ? t('workbench.app.openError', { reason: initial.error })
          : `Could not open the document: ${initial.error}`}
      </p>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocumentView
        key={document.id}
        namespace={`document:${document.id}`}
        initialTree={initial.tree}
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
            {saved === 'saving'
              ? t
                ? t('workbench.app.saving')
                : 'Saving…'
              : saved === 'saved'
                ? t
                  ? t('workbench.app.saved')
                  : 'Saved'
                : ''}
          </span>
        </div>
      </DocumentView>
    </div>
  );
}
