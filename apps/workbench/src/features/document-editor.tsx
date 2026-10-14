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
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { hotkeyLabel } from '@workspace/ui/hooks/hotkey-label';
import { useHotkey } from '@workspace/ui/hooks/use-hotkey';
import { useEditorBridge } from '@workspace/workbench-agent';
import {
  buildFindReplaceLabels,
  buildFormatToolsLabels,
  buildTableInsertLabels,
  defaultFindReplaceLabels,
  DocumentView,
  FIND_HIGHLIGHT_TAG,
  FindAndReplace,
  FormatTools,
  stripFindHighlights,
  TableInsert,
} from '@workspace/workbench-editor';
import { TextSearch } from 'lucide-react';
import type { SerializedEditorState } from 'lexical';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useDocuments,
  useDocumentVersions,
  useServices,
} from '../composition/app-services';
import { useWorkbenchTranslator } from '../i18n';
import { Spinner } from '../shell/boot-shell';
import { useOnline } from '../shell/use-online';
import { useDocumentChanges } from './document-changes';
import { useMayWriteDocument } from './document-write';
import {
  applyRemoteState,
  createAgentSeam,
  REMOTE_MERGE_TAG,
} from './document-editor.agent-state';
import { useDocumentRevision } from './document-revision';
import { FIND_HOTKEY } from './find/find.constants';
import { useLiveDocuments } from './live-documents';
import { useLiveEditors } from './live-editor';

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
  const { reload } = useDocumentRevision();
  const documents = useDocuments();
  const readOnly = !useMayWriteDocument(document.id);
  const versions = useDocumentVersions();
  const { identity, reportError, resolveError } = useServices();
  const t = useWorkbenchTranslator();
  const formatToolsLabels = useMemo(
    () => (t ? buildFormatToolsLabels(t) : undefined),
    [t]
  );
  const tableInsertLabels = useMemo(
    () => (t ? buildTableInsertLabels(t) : undefined),
    [t]
  );
  const findLabels = useMemo(
    () => (t ? buildFindReplaceLabels(t) : defaultFindReplaceLabels),
    [t]
  );
  /**
   * Find & replace is this surface's state, not the panel's: the surface is
   * keyed by the document, so opening another document forgets the search
   * by construction instead of carrying it over. The editor is kept in a
   * ref for the one thing the panel cannot do itself — hand focus back to
   * the text when it closes.
   */
  const [find, setFind] = useState(false);
  // Counts every request to open: the panel refocuses its field on each,
  // so the shortcut pressed again from the text brings the keyboard back.
  const [findFocus, setFindFocus] = useState(0);
  const wrapperRef = useRef<LexicalWrapper | null>(null);
  const openFind = useCallback(() => {
    setFind(true);
    setFindFocus((count) => count + 1);
  }, []);
  const onFindOpenChange = useCallback((open: boolean) => {
    setFind(open);
    if (open) return;
    const editor = wrapperRef.current?.editor;
    if (!editor) return;
    // The editor restores its own selection; the DOM focus is made explicit
    // because setting a selection moves focus only in some browsers.
    editor.focus();
    const root = editor.getRootElement();
    if (root && !root.contains(root.ownerDocument.activeElement))
      root.focus({ preventScroll: true });
  }, []);
  useHotkey(FIND_HOTKEY, openFind);
  const liveEditors = useLiveEditors();
  const [initial, setInitial] = useState<
    | { tree?: SerializedTree; markdown: string }
    | { error: string }
    | { awaiting: true }
    | null
  >(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  /**
   * How many times the document has been asked for again because the wait
   * for its first pull ended; each bump drops an answer still on its way,
   * which began before the pull and may still say "waiting".
   */
  const [loads, setLoads] = useState(0);
  /**
   * A body that arrived from another device before an editor mounted. The
   * load may have read the document just before it landed and answer only
   * afterwards; its older answer must not replace what already arrived.
   */
  const arrived = useRef<{ tree: SerializedTree; markdown: string }>(undefined);
  /**
   * The same body, until an editor has shown it. An editor mounting on an
   * older tree takes its initial content once and hands over its instance
   * a moment later; a body that lands in between is painted then.
   */
  const unpainted = useRef<{ tree: SerializedTree; markdown: string }>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    void documents.load(document.id).then((result) => {
      if (cancelled) return;
      if (result.isErr()) setInitial({ error: result.error });
      else if (arrived.current) setInitial(arrived.current);
      else if (!result.value.content && result.value.awaitingSync)
        // Known from the graph, not yet pulled: a wait, not an empty page.
        setInitial({ awaiting: true });
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
  }, [documents, document.id, loads]);

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

  /** Whether a refusal has been reported and not yet withdrawn. */
  const refused = useRef(false);
  useEffect(() => {
    const author: EditAuthor = { user: identity.userId, src: 'human' };
    const failureKey = `save:${document.id}`;
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
        // re-electing a leader after another tab closed, which passes. One
        // notice per document: the retry replaces it rather than adding.
        refused.current = true;
        reportError(
          { kind: 'save', title: document.title, reason: result.error },
          { key: failureKey }
        );
        setSaved('idle');
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persist(tree, markdown), 1000);
        return;
      }
      setSaved('saved');
      if (refused.current) {
        refused.current = false;
        resolveError(failureKey);
      }
      // Nothing changed: no write happened, so there is no new state to mark.
      if (!result.value) return;
      clearTimeout(versionTimer.current);
      versionTimer.current = setTimeout(() => {
        void versions.mark({ documentId: document.id, kind: 'idle' });
      }, VERSION_DEBOUNCE_MS);
    };
  }, [
    documents,
    versions,
    document.id,
    document.title,
    identity.userId,
    persist,
    reportError,
    resolveError,
  ]);

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

  const changes = useDocumentChanges();

  /**
   * The first pull of a document known only from the graph ended. When the
   * server held a body, the merge reaches the effect below; when it held
   * nothing there is no merge, and the pane — still on "waiting", or still
   * reading — asks again. A pane already showing a body is left alone.
   */
  const waiting = initial === null || 'awaiting' in initial;
  const waitingRef = useRef(waiting);
  useEffect(() => {
    waitingRef.current = waiting;
  }, [waiting]);
  useEffect(
    () =>
      changes.onSettled((id) => {
        if (id === document.id && waitingRef.current)
          setLoads((count) => count + 1);
      }),
    [changes, document.id]
  );

  /**
   * A merge from another device. The store folded this editor's tree in
   * before merging, so the merged tree is what this editor should now
   * show — painted through the same id reconciliation an agent result
   * takes — and a save still scheduled would only carry a tree the document
   * has moved past. A document still waiting for its first pull opens with
   * the body instead.
   */
  useEffect(
    () =>
      changes.onChanged((event) => {
        if (event.id !== document.id || event.source !== 'remote') return;
        const wrapper = wrapperRef.current;
        if (!wrapper) {
          const body = { tree: event.tree, markdown: event.markdown };
          arrived.current = body;
          unpainted.current = body;
          setInitial((current) =>
            current === null || 'awaiting' in current ? body : current
          );
          return;
        }
        clearTimeout(saveTimer.current);
        unsaved.current = undefined;
        if (isWrapperWithIds(wrapper)) {
          applyRemoteState(
            wrapper.editor,
            wrapper.mapping,
            event.tree as unknown as SerializedEditorState
          );
        } else {
          reload();
        }
      }),
    [changes, document.id, reload]
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
      wrapperRef.current = wrapper;
      const releaseEditor = liveEditors.register({
        documentId: document.id,
        wrapper,
      });
      // Search highlights are the panel's, not the document's: what leaves
      // this surface — a save, an export — is the tree without them.
      const release = live.register(document.id, () =>
        stripFindHighlights(
          wrapper.editor.getEditorState().toJSON() as unknown as SerializedTree
        )
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
          // A search moving its highlights, or a merge painted from another
          // device, is not an edit.
          if (tags.has(FIND_HIGHLIGHT_TAG) || tags.has(REMOTE_MERGE_TAG))
            return;
          if (tags.has('history-merge') && !edited.current) return;
          if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
          edited.current = true;
          const held = editorState.toJSON() as SerializedEditorState as
            SerializedTree | undefined;
          if (!held) return;
          const tree = stripFindHighlights(held);
          const markdown = editorStateAsMarkdown(editorState);
          unsaved.current = { tree, markdown };
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(
            () => void persist(tree, markdown),
            SAVE_DEBOUNCE_MS
          );
        }
      );
      // A merge that landed while this editor was mounting on an older tree.
      const waiting = unpainted.current;
      unpainted.current = undefined;
      if (waiting && isWrapperWithIds(wrapper)) {
        applyRemoteState(
          wrapper.editor,
          wrapper.mapping,
          waiting.tree as unknown as SerializedEditorState
        );
      }
      // The wrapper's own cleanup runs on unmount; chain ours onto it.
      const cleanup = wrapper.cleanup;
      wrapper.cleanup = () => {
        agent.setLive(null);
        releaseEditor();
        wrapperRef.current = null;
        release();
        unregister();
        cleanup();
      };
    },
    [persist, document.id, agent, live, liveEditors]
  );

  if (!initial)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
        <Spinner className="animate-spin" />{' '}
        {t ? t('workbench.app.opening') : 'Opening…'}
      </div>
    );
  if ('awaiting' in initial) return <Awaiting />;
  if ('error' in initial)
    return (
      <p className="text-destructive p-6 text-sm">
        {t
          ? t('workbench.app.openError', { reason: initial.error })
          : `Could not open the document: ${initial.error}`}
      </p>
    );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {readOnly ? (
        <p
          role="status"
          data-testid="document-read-only"
          className="text-muted-foreground border-b px-3 py-1 text-xs"
        >
          {t
            ? t('workbench.app.readOnly')
            : 'Read only: you can view this document'}
        </p>
      ) : null}
      <DocumentView
        key={document.id}
        namespace={`document:${document.id}`}
        readOnly={readOnly}
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
          <Hint label={findLabels.toggle} keys={hotkeyLabel(FIND_HOTKEY)}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={findLabels.toggle}
              aria-pressed={find}
              onClick={openFind}
              data-testid="find-replace-trigger"
            >
              <TextSearch aria-hidden />
            </Button>
          </Hint>
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
        <FindAndReplace
          open={find}
          onOpenChange={onFindOpenChange}
          focusRequest={findFocus}
          labels={findLabels}
          className="absolute top-12 right-4 z-10"
        />
      </DocumentView>
    </div>
  );
}

/**
 * A document this device knows only from the graph: its body is on the
 * server and arrives with the next pull — or, offline, once there is one.
 */
function Awaiting() {
  const t = useWorkbenchTranslator();
  const online = useOnline();
  return (
    <div
      className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm"
      data-testid="document-awaiting"
    >
      {online ? <Spinner className="animate-spin" /> : null}
      {online
        ? t
          ? t('workbench.app.awaitingServer')
          : 'Loading from the server…'
        : t
          ? t('workbench.app.awaitingDevice')
          : 'Not on this device yet. It loads once the server can be reached.'}
    </div>
  );
}
