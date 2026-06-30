'use client';

import { cn } from '@workspace/ui/lib/utils';

/**
 * The ONE document-title heading, shared by the READ view (`document-body-view`) and the
 * WRITE view (the doc-editor), so the title looks identical in both (WYSIWYG, no read↔edit
 * drift). Rendered in the SAME serif as the body content (`rich-content.css`) so the whole
 * document — title + body — reads as one authored piece, distinct from the shadcn chrome.
 *
 * The typography utilities are `!important`: on the WRITE surface Payload's admin CSS is
 * UNLAYERED and would otherwise beat the plain Tailwind utilities (font-family + weight +
 * size), so important keeps the title serif/bold/large in BOTH read and edit. Harmless on
 * the read surface (nothing competes there).
 */
const TITLE_CLASS = 'font-serif! text-3xl! font-bold! tracking-tight';

/** Static title — the READ view. */
export function DocumentTitle({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return <h1 className={cn('mb-6', TITLE_CLASS, className)}>{title}</h1>;
}

/**
 * Editable title — the WRITE view. The document title is the NODE title (outside the Lexical
 * body), edited inline here and persisted by the caller (`onCommit`) via the existing rename
 * route. A controlled input styled to look IDENTICAL to the static heading (so editing is
 * WYSIWYG with reading); the editor owns the value. Commits on blur and on Enter; Escape
 * reverts (the caller resets the value).
 */
export function EditableDocumentTitle({
  value,
  onChange,
  onCommit,
  onRevert,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onRevert: () => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onRevert();
          event.currentTarget.blur();
        }
      }}
      aria-label="Document title"
      className={cn(
        'mb-6 w-full border-0 bg-transparent py-0 outline-none',
        TITLE_CLASS,
        className
      )}
    />
  );
}
