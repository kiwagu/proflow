'use client';

import { RichText } from '@payloadcms/richtext-lexical/react';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { DocumentTitle } from '@workspace/ui/components/platform/document-title';
import * as React from 'react';

import './rich-content.css';

/**
 * DocumentBodyView — the ONE read-mode container for a Lexical body: the centred
 * reading column + Payload's `RichText` serializer (so formatting, lists,
 * headings, uploads/attachments all render via Payload's own converters) or an
 * honest empty state. Shared so the document reader and the version preview show
 * a body in the IDENTICAL surface — one renderer, one look.
 *
 * The serializer output is wrapped in `.rich-content` (see `rich-content.css`),
 * which mirrors the Payload Lexical editor's content typography 1:1 so a body
 * looks identical whether you READ it here or EDIT it on `/author/doc/[nodeId]`.
 * (`prose` was a no-op — `@tailwindcss/typography` is not installed — so the body
 * fell back to browser defaults and drifted from the editor.)
 */

/** The Lexical editor-state shape the `bodies` richText field stores. */
export type SerializedLexical = {
  root?: { children?: Array<{ type?: string; children?: unknown[] }> };
};

/** True when the body has no real content (null, or only empty paragraphs). */
export function isEmptyLexical(body: SerializedLexical | null): boolean {
  const children = body?.root?.children;
  if (!Array.isArray(children) || children.length === 0) {
    return true;
  }
  return children.every(
    (child) =>
      child?.type === 'paragraph' &&
      (!Array.isArray(child.children) || child.children.length === 0)
  );
}

export function DocumentBodyView({
  title,
  body,
  emptyLabel,
}: {
  /** Optional heading (the reader shows the doc title; the version dialog omits it). */
  title?: string;
  body: SerializedLexical | null;
  emptyLabel: string;
}) {
  return (
    <article className="mx-auto w-full max-w-[720px] px-6 py-10">
      {title ? <DocumentTitle title={title} /> : null}
      {isEmptyLexical(body) ? (
        <EmptyState>{emptyLabel}</EmptyState>
      ) : (
        <div className="rich-content">
          <RichText data={body as never} />
        </div>
      )}
    </article>
  );
}
