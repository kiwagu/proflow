import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_NORMAL,
  type CommandListener,
  type CommandListenerPriority,
  createCommand,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type UpdateListener,
} from 'lexical';
import { useEffect } from 'react';

export function mapRegisterDelete(
  editor: LexicalEditor,
  deleteFn: (payload: boolean) => boolean,
  priority: CommandListenerPriority
) {
  const deleteCommands = [
    DELETE_CHARACTER_COMMAND,
    DELETE_WORD_COMMAND,
    DELETE_LINE_COMMAND,
  ];
  return mergeRegister(
    ...deleteCommands.map((command) => {
      return editor.registerCommand(command, deleteFn, priority);
    })
  );
}

type WidthChangeCallback = (width: number) => void;
type EditorMutationCallback = () => void;

const observersByEditor = new WeakMap<
  LexicalEditor,
  {
    observer: ResizeObserver;
    callbacks: Set<WidthChangeCallback>;
  }
>();

const mutationObserversByEditor = new WeakMap<
  LexicalEditor,
  {
    observer: MutationObserver;
    callbacks: Set<EditorMutationCallback>;
    cleanupRootListener: () => void;
  }
>();

/**
 * Register a callback that runs when the width of the editor root changes. If a
 * a selector is provided, then the closest matching parent will be observed
 * instead. If the selector fails then the editor root will still be observed.
 * @param editor
 * @param onWidthChange
 * @param selector
 * @returns
 */
export function registerEditorWidthObserver(
  editor: LexicalEditor,
  onWidthChange: WidthChangeCallback,
  selector?: string
) {
  function getObserver() {
    if (!observersByEditor.has(editor)) {
      const callbacks = new Set<WidthChangeCallback>([onWidthChange]);

      const observer = new ResizeObserver((entries) => {
        const w = entries[0].contentBoxSize[0].inlineSize;
        callbacks.forEach((callback) => callback(w));
      });

      observersByEditor.set(editor, { observer, callbacks });
      return { observer, callbacks };
    }

    const editorObserver = observersByEditor.get(editor)!;
    editorObserver.callbacks.add(onWidthChange);
    return editorObserver;
  }

  const { observer } = getObserver();

  return mergeRegister(
    editor.registerRootListener((root) => {
      observer.disconnect();
      if (root) {
        let element = root;
        if (selector) {
          element = root.closest(selector) ?? root;
        }
        const currentWidth = element.getBoundingClientRect().width;
        onWidthChange(currentWidth);
        observer.observe(element);
      }
    }),
    () => {
      const editorEntry = observersByEditor.get(editor);
      if (editorEntry) {
        editorEntry.callbacks.delete(onWidthChange);
      }
      if (editorEntry && editorEntry.callbacks.size === 0) {
        editorEntry.observer.disconnect();
        observersByEditor.delete(editor);
      }
    }
  );
}

/**
 * Register a callback that runs when the editor root mutates. Observing is
 * shared per editor so multiple floating controls do not each attach their own
 * MutationObserver to the same root.
 */
export function registerEditorMutationObserver(
  editor: LexicalEditor,
  onMutation: EditorMutationCallback
) {
  let editorObserver = mutationObserversByEditor.get(editor);

  if (!editorObserver) {
    const callbacks = new Set<EditorMutationCallback>();
    const observer = new MutationObserver(() => {
      callbacks.forEach((callback) => callback());
    });

    const cleanupRootListener = editor.registerRootListener(
      (root, prevRoot) => {
        if (prevRoot) {
          observer.disconnect();
        }
        if (root) {
          observer.observe(root, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
      }
    );

    editorObserver = { observer, callbacks, cleanupRootListener };
    mutationObserversByEditor.set(editor, editorObserver);
  }

  editorObserver.callbacks.add(onMutation);

  return () => {
    const editorObserver = mutationObserversByEditor.get(editor);
    if (!editorObserver) return;

    editorObserver.callbacks.delete(onMutation);

    if (editorObserver.callbacks.size === 0) {
      editorObserver.observer.disconnect();
      editorObserver.cleanupRootListener();
      mutationObserversByEditor.delete(editor);
    }
  };
}

/**
 * Register one or more Lexical listeners for the lifetime of the calling
 * component. The registrations are created on mount and torn down on unmount.
 *
 * The origin's version took already-created cleanup functions, because its
 * reactive system could run the registration at any point in the component
 * body. React cannot: a registration made during render leaks on a discarded
 * render pass. So this takes the *registration* — a function that subscribes
 * and returns its own cleanup — and runs it inside an effect.
 *
 * @param editor The editor to register against.
 * @param register Subscribes and returns a cleanup function. It is re-run
 *   whenever the editor identity changes.
 */
export function useAutoRegister(
  editor: LexicalEditor | undefined,
  register: (editor: LexicalEditor) => () => void
): void {
  useEffect(() => {
    if (!editor) return;
    return register(editor);
    // The registration closure is intentionally not a dependency: callers
    // define it inline, so tracking it would re-subscribe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
}

/**
 * Register a Lexical command for the lifetime of the calling component.
 *
 * - When `handler` is `undefined` no command is registered.
 * - When it is a function the command is registered at `priority`.
 * - Changing the handler tears down the previous registration and creates a
 *   new one; unmounting always tears it down.
 *
 * @example
 * // Register only when an optional prop is provided:
 * useCommandEffect(
 *   editor,
 *   KEY_TAB_COMMAND,
 *   onTab ? (e) => onTab(e) : undefined,
 *   COMMAND_PRIORITY_CRITICAL,
 * );
 */
export function useCommandEffect<T>(
  editor: LexicalEditor | undefined,
  command: LexicalCommand<T>,
  handler: CommandListener<T> | undefined,
  priority: CommandListenerPriority
): void {
  useEffect(() => {
    if (!editor || !handler) return;
    return editor.registerCommand(command, handler, priority);
  }, [command, editor, handler, priority]);
}

const LAYOUT_SHFIT_COMMAND = createCommand<void>('LAYOUT_SHIFT_COMMAND');

/**
 * Register a callback to run whenever a non-mutating layout shift occurs – like when
 * a decorator changes size without writing to the lexical state.
 * @param editor
 * @param listener
 * @returns
 */
export function registerInternalLayoutShiftListener(
  editor: LexicalEditor,
  listener: () => void
) {
  return editor.registerCommand(
    LAYOUT_SHFIT_COMMAND,
    () => {
      listener();
      return false;
    },
    COMMAND_PRIORITY_NORMAL
  );
}

/**
 * Manually dispatch the internal layout shift event and trigger any listeners.
 * @param editor
 */
export function dispatchInternalLayoutShift(editor: LexicalEditor) {
  editor.dispatchCommand(LAYOUT_SHFIT_COMMAND, undefined);
}

/**
 * Wrapper on editor.registerUpdateListener that only calls the listener if there are dirty nodes.
 *     i.e. ignores selection change only updates.
 */
export function registerMutationListener(
  editor: LexicalEditor,
  fn: UpdateListener
) {
  return editor.registerUpdateListener((payload) => {
    if (payload.mutatedNodes !== null && payload.mutatedNodes.size > 0) {
      fn(payload);
    }
  });
}

/**
 * Wrapper on registerRootListener for nicer ergo on adding a single event
 * listener to the root div of a lexical editor.
 */
export function registerRootEventListener<K extends keyof HTMLElementEventMap>(
  editor: LexicalEditor,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) {
  return editor.registerRootListener((root, prevRoot) => {
    if (prevRoot) {
      prevRoot.removeEventListener(type, listener, options);
    }
    if (root) {
      root.addEventListener(type, listener, options);
    }
  });
}
