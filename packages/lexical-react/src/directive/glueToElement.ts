import { autoUpdate, computePosition, hide } from '@floating-ui/dom';
import type { LexicalEditor } from 'lexical';
import { useEffect, useRef } from 'react';
import { registerEditorMutationObserver } from '../plugins/shared/utils';

type GlueToElementProps = {
  editor: LexicalEditor;
  element: () => HTMLElement | undefined | null;
};

function style(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
  Object.assign(el.style, styles);
}

/**
 * Glues one element to another one as children of a lexical editor. Useful for
 * attaching floating elements to a LexicalEditor without inserting them into
 * the content editable lexical-managed DOM.
 *
 * The origin implementation is a framework directive applied to a node ref.
 * Here it is a plain imperative binder returning its own teardown, so both the
 * hook below and non-component callers can use it.
 */
export function glueToElement(
  floatingElement: HTMLElement,
  propAccessor: () => GlueToElementProps
): () => void {
  style(floatingElement, { position: 'absolute' });

  let animationFrame: number | undefined;

  const scheduleUpdatePosition = () => {
    if (animationFrame !== undefined) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = undefined;
      void updatePosition();
    });
  };

  async function updatePosition() {
    const el = propAccessor().element();
    const root = propAccessor().editor.getRootElement();
    const mount = floatingElement.offsetParent as HTMLElement | null;

    if (!el || !root || !mount) {
      style(floatingElement, { display: 'none' });
      return;
    }

    const { middlewareData } = await computePosition(el, floatingElement, {
      middleware: [hide()],
    });

    const rect = el.getBoundingClientRect();
    const mountRect = mount.getBoundingClientRect();
    const offsetLeft = rect.left - mountRect.left + mount.scrollLeft;
    const offsetTop = rect.top - mountRect.top + mount.scrollTop;

    style(floatingElement, {
      display: '',
      left: `${offsetLeft}px`,
      top: `${offsetTop}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      visibility: middlewareData.hide?.referenceHidden ? 'hidden' : 'visible',
    });
  }

  const referenceEl = propAccessor().element() ?? null;
  const cleanupAutoUpdate = referenceEl
    ? autoUpdate(referenceEl, floatingElement, updatePosition)
    : () => {};
  const cleanupEditorMutationObserver = registerEditorMutationObserver(
    propAccessor().editor,
    scheduleUpdatePosition
  );

  return () => {
    cleanupAutoUpdate();
    cleanupEditorMutationObserver();
    if (animationFrame !== undefined) {
      cancelAnimationFrame(animationFrame);
    }
  };
}

/**
 * Component-scoped {@link glueToElement}: attach the returned ref callback to
 * the floating element and it stays glued for the component's lifetime.
 */
export function useGlueToElement(
  editor: LexicalEditor,
  element: HTMLElement | undefined | null
) {
  const floatingRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const floating = floatingRef.current;
    if (!floating || !element) return;
    return glueToElement(floating, () => ({ editor, element: () => element }));
  }, [editor, element]);

  return floatingRef;
}
