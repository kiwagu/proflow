'use client';

import { useLexicalWrapper } from '@workspace/lexical-react';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { cn } from '@workspace/ui/lib/utils';
import { useEffect, useState } from 'react';
import {
  getActiveHeadingIndex,
  shouldShowOutline,
  useOutlineHeadings,
} from './outline.js';
import { defaultOutlineLabels, type OutlineLabels } from './labels.js';

export type OutlineProps = {
  labels?: OutlineLabels;
  /** The scrollable element the document renders in — used to track the
   * active heading and to scroll a heading into view. Usually the same
   * element DocumentView scrolls (its content container). */
  scrollContainer: HTMLElement | null | undefined;
  className?: string;
};

const ACTIVE_HEADING_OFFSET = 80;

/**
 * The document outline: a heading tree with click-to-scroll navigation and
 * live active-heading tracking against the scroll position. Hides itself
 * below the minimum heading count (a short document has nothing to outline).
 * Must render inside a DocumentView (wrapper context).
 */
export function Outline({
  labels = defaultOutlineLabels,
  scrollContainer,
  className,
}: OutlineProps) {
  const wrapper = useLexicalWrapper();
  const editor = wrapper.editor;
  const headings = useOutlineHeadings(editor);
  const [activeKey, setActiveKey] = useState<string>();

  useEffect(() => {
    if (!scrollContainer || headings.length === 0) return;

    let frame: number | undefined;
    const syncActiveHeading = () => {
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const activeLine = containerTop + ACTIVE_HEADING_OFFSET;
      const headingTops = headings.map(
        (heading) =>
          editor.getElementByKey(heading.key)?.getBoundingClientRect().top ??
          Number.POSITIVE_INFINITY
      );
      const activeIndex = getActiveHeadingIndex(headingTops, activeLine);
      setActiveKey(headings[activeIndex]?.key);
    };

    const queueSync = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncActiveHeading);
    };

    queueSync();
    scrollContainer.addEventListener('scroll', queueSync, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', queueSync);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [editor, headings, scrollContainer]);

  if (!shouldShowOutline(headings.length)) return null;

  const scrollToHeading = (key: string) => {
    const element = editor.getElementByKey(key);
    if (!element || !scrollContainer) return;
    const containerTop = scrollContainer.getBoundingClientRect().top;
    const elementTop = element.getBoundingClientRect().top;
    scrollContainer.scrollTo({
      top:
        scrollContainer.scrollTop +
        elementTop -
        containerTop -
        ACTIVE_HEADING_OFFSET,
      behavior: 'smooth',
    });
    setActiveKey(key);
  };

  return (
    <nav aria-label={labels.nav} className={cn('w-52 shrink-0', className)}>
      <ScrollArea className="max-h-[calc(100vh-6rem)]">
        <ul className="flex flex-col gap-0.5 p-1">
          {headings.map((heading) => (
            <li key={heading.key}>
              <button
                type="button"
                aria-label={heading.text}
                aria-current={
                  activeKey === heading.key ? 'location' : undefined
                }
                className={cn(
                  'text-muted-foreground hover:bg-accent hover:text-foreground h-7 w-full truncate rounded-md px-2 text-left text-xs',
                  activeKey === heading.key && 'text-foreground font-semibold'
                )}
                style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
                onClick={() => scrollToHeading(heading.key)}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </nav>
  );
}
