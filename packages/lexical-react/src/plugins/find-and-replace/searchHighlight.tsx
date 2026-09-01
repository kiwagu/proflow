import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../reactive/store';
import {
  registerEditorWidthObserver,
  registerInternalLayoutShiftListener,
  useAutoRegister,
} from '../shared/utils';
import {
  FindAndReplaceStore,
  setFindAndReplaceState,
} from './findAndReplaceStore';
import type { NodekeyOffset } from './findAndReplacePlugin';
import {
  type FloatingStyle,
  getFloatingSearchHighlightPosition,
} from './getFloatingSearchHighlightStyle';

function getFirstChild(htmlEl: ChildNode | null | undefined) {
  if (htmlEl?.firstChild) {
    return getFirstChild(htmlEl.firstChild);
  }
  return htmlEl;
}

function registerEventListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | null,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void
): () => void;
function registerEventListener(
  target: HTMLElement | null,
  type: string,
  listener: EventListener
) {
  if (!target) return () => {};
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

/**
 * Keeps the floating highlight rectangles in sync with the current search
 * matches. Renders nothing itself — {@link FloatingSearchHighlight} paints the
 * rectangles this component measures.
 */
export function SearchHighlight({
  editor,
  anchorElem = document.body,
}: {
  editor: LexicalEditor | undefined;
  anchorElem?: HTMLElement;
}): null {
  const listOffset = useStore(FindAndReplaceStore).listOffset;
  const stateListOffsetRef = useRef<NodekeyOffset[]>([]);
  const animationFrame = useRef<number | undefined>(undefined);

  const updateTextFormatFloatingToolbar = useCallback(
    (offsets: NodekeyOffset[], editorInstance: LexicalEditor) => {
      const newStyles: { style: FloatingStyle; idx: number | undefined }[] = [];
      let matches = 0;
      offsets.map((offset: NodekeyOffset) => {
        const htmlEl = getFirstChild(
          editorInstance.getElementByKey(offset.key)?.firstChild
        );
        if (!htmlEl) return;
        const range = document.createRange();
        try {
          range.setStart(htmlEl, offset.offset.start);
          range.setEnd(htmlEl, offset.offset.end);
          const rects = range.getClientRects();
          [...rects].map((rect) => {
            const newStyle = getFloatingSearchHighlightPosition(
              rect,
              anchorElem
            );
            const styleWidth = newStyle.width;
            if (
              Number.parseInt(
                String(styleWidth).substring(0, String(styleWidth).length - 2)
              ) !== 4
            ) {
              newStyles.push({ style: newStyle, idx: offset.pairKey });
              matches = Math.max(matches, offset.pairKey ?? 0);
            }
          });
        } catch (error) {
          console.error(error);
        }
      });

      setFindAndReplaceState('styles', newStyles);
      setFindAndReplaceState('matches', matches);
    },
    [anchorElem]
  );

  const update = useCallback(() => {
    if (animationFrame.current !== undefined) {
      cancelAnimationFrame(animationFrame.current);
    }

    animationFrame.current = requestAnimationFrame(() => {
      animationFrame.current = undefined;
      if (!editor) return;

      editor.getEditorState().read(() => {
        updateTextFormatFloatingToolbar(stateListOffsetRef.current, editor);
      });
    });
  }, [editor, updateTextFormatFloatingToolbar]);

  useEffect(() => {
    stateListOffsetRef.current = listOffset;
    update();
  }, [listOffset, update]);

  useAutoRegister(editor, (editorInstance) =>
    mergeRegister(
      registerInternalLayoutShiftListener(editorInstance, update),
      registerEditorWidthObserver(editorInstance, update, '[data-block-content]'),
      editorInstance.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        update();
      })
    )
  );

  useEffect(() => {
    const unregister = registerEventListener(
      anchorElem.parentElement,
      'scroll',
      update
    );
    return () => {
      unregister();
      if (animationFrame.current !== undefined) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [anchorElem, update]);

  return null;
}

export function FloatingSearchHighlight({
  anchorElem,
  className,
}: {
  anchorElem?: HTMLElement;
  /** Optional joiner so the host can supply its own class merge helper. */
  className?: (...classes: (string | false | undefined)[]) => string;
}) {
  const state = useStore(FindAndReplaceStore);
  const join =
    className ?? ((...classes) => classes.filter(Boolean).join(' '));

  return createPortal(
    <>
      {state.styles.map((item, index) => (
        <div
          // Highlight rectangles are positional and have no stable identity.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          style={item.style}
          className={join(
            'z-10 m-0 text-transparent h-4.5 absolute top-0 left-0 opacity-50 pointer-events-none',
            item.idx === state.currentMatch + 1 ? 'bg-accent' : 'bg-accent/50'
          )}
        />
      ))}
    </>,
    anchorElem ?? document.body
  );
}
