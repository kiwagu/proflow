'use client';

import { RichText } from '@payloadcms/richtext-lexical/react';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { ArrowLeft, Pencil } from 'lucide-react';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';

/**
 * DocumentReader — the minimal, empty-but-live read-view for a `kind=text` node
 * (increment A3). It is the embryonic Workbench reading surface: a node-centric
 * document canvas opened from Drive (a content card click), NOT the ResourcePanel
 * (which stays the Details drawer).
 *
 * It reads the REAL Lexical body through the RLS-gated body endpoint
 * (`GET /author/graph/text-resources` — node access resolved under the user's own
 * RLS, then the body fetched by `node_id`, ADR-0002 §2) and renders it read-only
 * with Payload's own Lexical→React serializer (`RichText`), so the rendered output
 * matches exactly what the future editor produces — zero bespoke renderer, zero
 * duplication.
 *
 * No mock: a freshly created document has a real but empty body, so the reader
 * shows an honest empty state until the editor (a later increment) adds content.
 */

type ReaderState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; body: SerializedLexical | null };

/** The Lexical editor-state shape the `bodies` richText field stores. */
type SerializedLexical = {
  root?: { children?: Array<{ type?: string; children?: unknown[] }> };
};

/** True when the body has no real content (null, or only empty paragraphs). */
function isEmptyLexical(body: SerializedLexical | null): boolean {
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

export function DocumentReader({
  spaceId,
  nodeId,
  title,
  messages,
  onClose,
}: {
  spaceId: string;
  nodeId: string;
  title: string;
  messages: Record<string, string>;
  onClose: () => void;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);
  const [state, setState] = React.useState<ReaderState>({ status: 'loading' });
  const mounted = React.useRef(false);

  // Fetch the latest body. Does NOT flip back to 'loading', so a focus-refetch
  // updates content silently (no flicker). Guarded against setState-after-unmount.
  const loadBody = React.useCallback(async () => {
    const url = `/author/graph/text-resources?node_id=${encodeURIComponent(
      nodeId
    )}&space_id=${encodeURIComponent(spaceId)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new Error('read');
      }
      const data = (await res.json()) as { body?: SerializedLexical | null };
      if (mounted.current) {
        setState({ status: 'ready', body: data.body ?? null });
      }
    } catch {
      if (mounted.current) {
        setState({ status: 'error' });
      }
    }
  }, [nodeId, spaceId]);

  React.useEffect(() => {
    mounted.current = true;
    void loadBody();
    // Returning from the Payload admin editor (a full navigation away) refocuses
    // the window — refetch so the reader reflects a just-saved edit.
    const onFocus = () => void loadBody();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [loadBody]);

  // Edit opens the node-centric resolver, which 302s to the native Payload admin
  // document (Lexical editor + versions/drafts) — the editor is Payload's own.
  const editHref = `${AUTHOR_BASE_PATH}/graph/doc/${encodeURIComponent(
    nodeId
  )}/edit`;

  return (
    <div className="bg-background absolute inset-0 z-10 flex flex-col">
      {/* reader toolbar — back + title */}
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <ArrowLeft className="size-4" aria-hidden />
          {t('graph.reader.back')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => window.location.assign(editHref)}
        >
          <Pencil className="size-4" aria-hidden />
          {t('graph.reader.edit')}
        </Button>
      </div>

      {/* reading column */}
      <div className="min-h-0 flex-1 overflow-auto">
        <article className="mx-auto w-full max-w-[720px] px-6 py-10">
          <h1 className="mb-6 text-3xl font-bold tracking-tight">{title}</h1>

          {state.status === 'loading' ? (
            <p className="text-muted-foreground text-sm">
              {t('graph.reader.loading')}
            </p>
          ) : null}

          {state.status === 'error' ? (
            <p role="alert" className="text-destructive text-sm">
              {t('graph.reader.error')}
            </p>
          ) : null}

          {state.status === 'ready' && isEmptyLexical(state.body) ? (
            <EmptyState>{t('graph.reader.empty')}</EmptyState>
          ) : null}

          {state.status === 'ready' && !isEmptyLexical(state.body) ? (
            <div className="prose dark:prose-invert max-w-none">
              <RichText data={state.body as never} />
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}
