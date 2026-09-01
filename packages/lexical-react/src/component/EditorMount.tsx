/**
 * @file The editor mount: creates a wrapper, attaches the editor to a
 * contenteditable element, and publishes the wrapper to descendants.
 *
 * The origin mounts the editor from a framework directive on the editable
 * element. React has no directives, so the same lifecycle is expressed as a
 * ref plus effects: the wrapper is created once per mount, the root element is
 * set when the ref lands, and everything is torn down on unmount.
 */
import type { EditorType } from '@workspace/lexical-nodes';
import type { EditorThemeClasses } from 'lexical';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  createLexicalWrapper,
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../context/LexicalWrapperContext';

export type EditorMountProps = {
  type: EditorType;
  namespace: string;
  /** Whether the editor accepts input. Read live, as the origin does. */
  isInteractable?: () => boolean;
  withIds?: boolean;
  theme?: EditorThemeClasses;
  className?: string;
  /**
   * Called once the wrapper exists, before the root element is attached, so a
   * host can register plugins and decorators against it.
   */
  onWrapper?: (wrapper: LexicalWrapper) => void;
  /** Rendered inside the wrapper context — accessory renderers, popups, menus. */
  children?: ReactNode;
};

type MountState = {
  wrapper: LexicalWrapper;
  setInteractable: (fn: () => boolean) => void;
};

/**
 * Creates the wrapper together with the mutable slot holding the host's live
 * `isInteractable`. The slot is created and read entirely outside React — the
 * editor's plugins call it against the raw editor, with no component around —
 * so it is deliberately not a ref.
 */
function createMountState({
  type,
  namespace,
  withIds,
  theme,
  isInteractable,
}: {
  type: EditorType;
  namespace: string;
  withIds?: boolean;
  theme?: EditorThemeClasses;
  isInteractable: () => boolean;
}): MountState {
  let current = isInteractable;
  const wrapper = createLexicalWrapper({
    type,
    namespace,
    withIds: withIds as false | undefined,
    theme,
    isInteractable: () => current(),
  });

  return {
    wrapper,
    setInteractable(fn) {
      current = fn;
    },
  };
}

export function EditorMount({
  type,
  namespace,
  isInteractable = () => true,
  withIds,
  theme,
  className,
  onWrapper,
  children,
}: EditorMountProps) {
  const [editable, setEditable] = useState<HTMLDivElement | null>(null);

  // The wrapper owns a Lexical editor instance, so it must survive re-renders:
  // it is created once per identity of its configuration args. `isInteractable`
  // is deliberately not one of them — the wrapper reads it through a mutable
  // slot created alongside it, so a host may pass a fresh closure every render
  // without the editor being torn down.
  const [state, setState] = useState(() =>
    createMountState({ type, namespace, withIds, theme, isInteractable })
  );

  const configKey = `${type}\u0000${namespace}\u0000${String(withIds)}`;
  const [lastKey, setLastKey] = useState(configKey);
  if (lastKey !== configKey) {
    setLastKey(configKey);
    setState(createMountState({ type, namespace, withIds, theme, isInteractable }));
  }

  const wrapper = state.wrapper;
  state.setInteractable(isInteractable);

  useEffect(() => {
    onWrapper?.(wrapper);
    return () => wrapper.cleanup();
    // `onWrapper` is a host callback; re-running on its identity would tear the
    // editor down on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapper]);

  useEffect(() => {
    wrapper.editor.setRootElement(editable);
    return () => {
      wrapper.editor.setRootElement(null);
    };
  }, [wrapper, editable]);

  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div
        ref={setEditable}
        className={className}
        contentEditable
        suppressContentEditableWarning
        data-lexical-editor
      />
      {children}
    </LexicalWrapperContext.Provider>
  );
}
