'use client';

import { RichText } from '@payloadcms/richtext-lexical/react';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { cn } from '@workspace/ui/lib/utils';
import { ArrowLeft, Pencil } from 'lucide-react';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';

/**
 * DocumentReader — the node-centric read-view for a `kind=text` node, opened from
 * Drive. Reads the REAL Lexical body through the RLS-gated body endpoint
 * (`GET /author/graph/text-resources`, ADR-0002 §2) and renders it read-only with
 * Payload's own `RichText` serializer (zero bespoke renderer). Shows the
 * draft/published status badge.
 *
 * Editing happens on a dedicated route (`/author/doc/[nodeId]`) that mounts
 * Payload's FULL editor under its own provider environment (`RootLayout` +
 * `RenderLexical`) — no admin nav. "Edit" navigates there; on return the reader
 * refetches (window focus) so the just-saved body shows.
 */

type ReaderState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      body: SerializedLexical | null;
      docStatus: string | null;
    };

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
      const data = (await res.json()) as {
        body?: SerializedLexical | null;
        status?: string | null;
      };
      if (mounted.current) {
        setState({
          status: 'ready',
          body: data.body ?? null,
          docStatus: data.status ?? null,
        });
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
    // Returning from the editor route (a full navigation away) refocuses the
    // window — refetch so the reader reflects a just-saved edit.
    const onFocus = () => void loadBody();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [loadBody]);

  // "Edit" opens the dedicated editor route (Payload's full editor under its own
  // RootLayout environment, no admin nav).
  const editHref = `${AUTHOR_BASE_PATH}/doc/${encodeURIComponent(nodeId)}`;

  return (
    <div className="bg-background absolute inset-0 z-10 flex flex-col">
      {/* reader toolbar — back + status + edit */}
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <ArrowLeft className="size-4" aria-hidden />
          {t('graph.reader.back')}
        </Button>

        {state.status === 'ready' && state.docStatus ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] font-medium',
              state.docStatus === 'published'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {state.docStatus === 'published'
              ? t('graph.reader.statusPublished')
              : t('graph.reader.statusDraft')}
          </span>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => window.location.assign(editHref)}
          disabled={state.status !== 'ready'}
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
