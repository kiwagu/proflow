'use client';

import {
  EditorMount,
  type LexicalWrapper,
  selectionDataPlugin,
  DefaultShortcuts,
  keyboardShortcutsPlugin,
  linksPlugin,
  tabIndentationPlugin,
  tablePlugin,
  tablePickerPlugin,
} from '@workspace/lexical-react';
import { setEditorStateFromMarkdown } from '@workspace/lexical-react/utils';
import { cn } from '@workspace/ui/lib/utils';
import type { EditorThemeClasses } from 'lexical';
import { CLEAR_HISTORY_COMMAND } from 'lexical';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';

export type DocumentViewProps = {
  /** Namespace hint for the underlying editor — useful for debugging. */
  namespace?: string;
  /**
   * Markdown to load once when the editor mounts. Later changes to this prop
   * are deliberately ignored: the editor owns the document after mount, and
   * reloading under the user's cursor would drop their edits. Remount (change
   * the `key`) to show a different document.
   */
  initialMarkdown?: string;
  /** Whether the editor accepts input. Read live on each interaction. */
  readOnly?: boolean;
  /**
   * Called with the wrapper once the editor exists — the seam for hosts and
   * siblings (FormatTools, TableInsert, sync bindings) that need the editor.
   */
  onWrapper?: (wrapper: LexicalWrapper) => void;
  /**
   * Called when the user asks for a table via the picker command and no
   * floating picker is mounted to serve it. TableInsert wires this.
   */
  onCreateTable?: () => void;
  className?: string;
  /** Extra classes for the editable surface itself. */
  contentClassName?: string;
  theme?: EditorThemeClasses;
  /** Rendered inside the wrapper context — toolbars, popups, accessories. */
  children?: ReactNode;
};

/**
 * The document editing surface: a full rich-text markdown editor wired with
 * the standing plugin set (history, rich text, lists, markdown shortcuts,
 * selection tracking, links, tables, indentation, keyboard shortcuts).
 *
 * Composition seam: everything that needs the editor renders as children and
 * reads the wrapper from context — the shell stays ignorant of which chrome
 * is mounted around it.
 *
 * Coupling note: plugins are wired through the wrapper's plugin manager and
 * the editor-type registries, not against individual node classes, so the
 * node-vocabulary package can evolve underneath without touching this shell.
 */
export function DocumentView({
  namespace = 'document',
  initialMarkdown,
  readOnly = false,
  onWrapper,
  onCreateTable,
  className,
  contentClassName,
  theme,
  children,
}: DocumentViewProps) {
  // Read live through refs so a re-render with new props never tears the
  // editor down (the mount memoizes on its config identity). Assigned in an
  // effect (not during render) per the hooks contract; the readers are all
  // event/plugin code that runs later.
  const readOnlyRef = useRef(readOnly);
  const onCreateTableRef = useRef(onCreateTable);
  const onWrapperRef = useRef(onWrapper);
  const initialMarkdownRef = useRef(initialMarkdown);
  useEffect(() => {
    readOnlyRef.current = readOnly;
    onCreateTableRef.current = onCreateTable;
    onWrapperRef.current = onWrapper;
  });

  const handleWrapper = useCallback((wrapper: LexicalWrapper) => {
    wrapper.plugins
      .history()
      .richText()
      .list()
      .delete()
      .markdownShortcuts()
      .use(selectionDataPlugin(wrapper))
      .use(tabIndentationPlugin())
      .use(linksPlugin({}))
      .use(tablePlugin({ hasHorizontalScroll: true }))
      .use(
        tablePickerPlugin({
          onCreateTable: () => onCreateTableRef.current?.(),
        })
      )
      .use(keyboardShortcutsPlugin({ shortcuts: DefaultShortcuts }));

    const markdown = initialMarkdownRef.current;
    if (markdown !== undefined) {
      setEditorStateFromMarkdown(wrapper.editor, markdown);
      // The load is the document's baseline, not the first undoable edit.
      wrapper.editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }

    onWrapperRef.current?.(wrapper);
  }, []);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <EditorMount
        type="markdown"
        withIds
        namespace={namespace}
        isInteractable={() => !readOnlyRef.current}
        theme={theme}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none',
          contentClassName
        )}
        onWrapper={handleWrapper}
      >
        {children}
      </EditorMount>
    </div>
  );
}
