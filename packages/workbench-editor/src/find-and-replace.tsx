'use client';

import { useEditorEditable, useLexicalWrapper } from '@workspace/lexical-react';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { Input } from '@workspace/ui/components/input';
import { ToggleChip } from '@workspace/ui/components/toggle-chip';
import { cn } from '@workspace/ui/lib/utils';
import {
  ChevronDown,
  ChevronUp,
  Replace as ReplaceIcon,
  ReplaceAll as ReplaceAllIcon,
  SearchIcon,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeNextMatchIndex,
  replaceAllMatches,
  replaceMatch,
  searchAndHighlight,
  type FindMatch,
} from './find-replace.js';
import { defaultFindReplaceLabels, type FindReplaceLabels } from './labels.js';

export type FindAndReplaceProps = {
  labels?: FindReplaceLabels;
  /** Rendered open initially; the caller usually flips this from a toolbar
   * toggle or a keyboard shortcut (Cmd/Ctrl+F handling is the host's). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Bump to put the keyboard back in the search field while the panel is
   * already open — the shortcut pressed again from the text, typically.
   */
  focusRequest?: number;
  className?: string;
};

/**
 * Find & replace over the live document: debounced search highlights every
 * match with a MarkNode, next/prev steps through them, replace-one and
 * replace-all mutate the document and clear the highlights. Must render
 * inside a DocumentView (wrapper context).
 */
export function FindAndReplace({
  labels = defaultFindReplaceLabels,
  open,
  onOpenChange,
  focusRequest = 0,
  className,
}: FindAndReplaceProps) {
  const wrapper = useLexicalWrapper();
  const editor = wrapper.editor;
  // Live: rights can go while the panel is open with its fields filled in.
  const editable = useEditorEditable(editor);
  const disabled = !editable || !wrapper.isInteractable();

  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    if (!open) return;
    searchInputRef.current?.focus();
  }, [open, focusRequest]);

  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const found = searchAndHighlight(editor, query, caseSensitive);
      setMatches(found);
      setCurrentIndex(found.length > 0 ? 0 : -1);
    }, 200);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- searchAndHighlight/editor are stable
  }, [query, caseSensitive, open]);

  const scrollToMatch = (index: number) => {
    const match = matches[index];
    if (!match) return;
    const element = editor.getElementByKey(match.key);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const jumpTo = (direction: 'next' | 'prev') => {
    const next = computeNextMatchIndex(currentIndex, matches.length, direction);
    setCurrentIndex(next);
    scrollToMatch(next);
  };

  const replaceCurrent = () => {
    if (!editor.isEditable() || !replacement || currentIndex === -1) return;
    const match = matches[currentIndex];
    if (!match) return;
    replaceMatch(editor, match.id, replacement);
    const remaining = matches.filter((_, i) => i !== currentIndex);
    setMatches(remaining);
    setCurrentIndex(
      remaining.length > 0 ? currentIndex % remaining.length : -1
    );
  };

  const replaceAll = () => {
    if (!editor.isEditable() || !replacement || matches.length === 0) return;
    replaceAllMatches(editor, matches, replacement);
    setMatches([]);
    setCurrentIndex(-1);
  };

  const status = useMemo(() => {
    if (!query) return '';
    if (matches.length === 0) return labels.noMatches;
    return labels.matchStatus(currentIndex + 1, matches.length);
  }, [query, matches.length, currentIndex, labels]);

  const close = () => {
    searchAndHighlight(editor, '', caseSensitive);
    setMatches([]);
    setCurrentIndex(-1);
    setQuery('');
    setReplacement('');
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      role="search"
      aria-label={labels.toggle}
      className={cn(
        'bg-background flex w-fit items-center gap-2 rounded-xl border p-2 shadow-lg',
        className
      )}
    >
      <SearchIcon
        aria-hidden
        className="text-muted-foreground size-4 shrink-0"
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Input
            ref={searchInputRef}
            value={query}
            placeholder={labels.findPlaceholder}
            aria-label={labels.toggle}
            className="h-7 w-48"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'Enter') jumpTo(e.shiftKey ? 'prev' : 'next');
            }}
          />
          <span className="text-muted-foreground w-20 shrink-0 text-xs whitespace-nowrap">
            {status}
          </span>
          <ToggleChip
            label="Aa"
            pressed={caseSensitive}
            onPressedChange={setCaseSensitive}
            hint={labels.caseSensitive}
          />
          <Hint label={labels.previousMatch}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={labels.previousMatch}
              disabled={matches.length === 0}
              onClick={() => jumpTo('prev')}
            >
              <ChevronUp aria-hidden />
            </Button>
          </Hint>
          <Hint label={labels.nextMatch}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={labels.nextMatch}
              disabled={matches.length === 0}
              onClick={() => jumpTo('next')}
            >
              <ChevronDown aria-hidden />
            </Button>
          </Hint>
          <Hint label={labels.close}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={labels.close}
              onClick={close}
            >
              <X aria-hidden />
            </Button>
          </Hint>
        </div>

        {!disabled ? (
          <div className="flex items-center gap-1">
            <Input
              value={replacement}
              placeholder={labels.replacePlaceholder}
              aria-label={labels.replacePlaceholder}
              className="h-7 w-48"
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                if (e.key === 'Enter') replaceCurrent();
              }}
            />
            <Hint label={labels.replaceOne}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={labels.replaceOne}
                disabled={matches.length === 0}
                onClick={replaceCurrent}
              >
                <ReplaceIcon aria-hidden />
              </Button>
            </Hint>
            <Hint label={labels.replaceAll}>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={labels.replaceAll}
                disabled={matches.length === 0}
                onClick={replaceAll}
              >
                <ReplaceAllIcon aria-hidden />
              </Button>
            </Hint>
          </div>
        ) : null}
      </div>
    </div>
  );
}
