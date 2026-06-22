'use client';

import { EmptyState } from '@workspace/ui/components/empty-state';
import { cn } from '@workspace/ui/lib/utils';
import { diffWords } from 'diff';
import * as React from 'react';

import type { SerializedLexical } from './document-body-view';

/**
 * RevisionDiff — a SIMPLE, reader-width text diff between two document-body
 * versions. It extracts the plain text from each Lexical body (one block per
 * paragraph) and word-diffs them (jsdiff): additions are highlighted, removals
 * struck through. Deliberately TEXT-ONLY — it shows content changes, not
 * formatting/structure changes (that is a richer, separate diff). Two versions
 * that differ only in formatting read as "no text changes".
 */

type LexNode = { text?: string; children?: LexNode[] };

/** Plain text of a Lexical body — concatenate text nodes, one block per line. */
function lexicalToPlainText(body: SerializedLexical | null): string {
  const blockText = (node: LexNode): string => {
    if (typeof node.text === 'string') {
      return node.text;
    }
    if (Array.isArray(node.children)) {
      return node.children.map(blockText).join('');
    }
    return '';
  };
  const blocks = (body?.root?.children ?? []) as LexNode[];
  return blocks.map(blockText).join('\n\n').trim();
}

export function RevisionDiff({
  before,
  after,
  emptyLabel,
}: {
  /** Older version (baseline). */
  before: SerializedLexical | null;
  /** Newer version. */
  after: SerializedLexical | null;
  /** Shown when the two versions have identical text. */
  emptyLabel: string;
}) {
  const parts = React.useMemo(
    () => diffWords(lexicalToPlainText(before), lexicalToPlainText(after)),
    [before, after]
  );
  const changed = parts.some((p) => p.added || p.removed);

  if (!changed) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-6 py-10">
        <EmptyState>{emptyLabel}</EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-10 text-sm leading-relaxed whitespace-pre-wrap">
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.added && 'bg-primary/10 text-primary rounded-sm',
            part.removed &&
              'bg-destructive/10 text-destructive rounded-sm line-through'
          )}
        >
          {part.value}
        </span>
      ))}
    </div>
  );
}
