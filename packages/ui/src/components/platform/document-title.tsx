'use client';

import { cn } from '@workspace/ui/lib/utils';

/**
 * The ONE document-title heading, shared by a READ view and a WRITE (inline-edit) view so the
 * title looks identical in both (WYSIWYG, no read↔edit drift). Rendered in the SAME serif as
 * the body content so the whole document — title + body — reads as one authored piece, distinct
 * from the surrounding chrome.
 *
 * The typography utilities are `!important`: on a WRITE surface an UNLAYERED admin CSS could
 * otherwise beat the plain Tailwind utilities (font-family + weight + size), so important keeps
 * the title serif/bold/large in BOTH read and edit. Harmless on the read surface (nothing
 * competes there). Generic and i18n-free: any accessible label is a resolved string prop.
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
 * Editable title — the WRITE view. A controlled input styled to look IDENTICAL to the static
 * heading (so editing is WYSIWYG with reading); the caller owns the value and persists it.
 * Commits on blur and on Enter; Escape reverts (the caller resets the value). The accessible
 * name is passed in via `ariaLabel` (no i18n inside the lib).
 */
export function EditableDocumentTitle({
  value,
  onChange,
  onCommit,
  onRevert,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  onCommit: () => void;
  onRevert: () => void;
  ariaLabel: string;
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
      aria-label={ariaLabel}
      className={cn(
        'mb-6 w-full border-0 bg-transparent py-0 outline-none',
        TITLE_CLASS,
        className
      )}
    />
  );
}
