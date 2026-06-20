'use client';

import { RichText } from '@payloadcms/richtext-lexical/react';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { ArrowLeft } from 'lucide-react';
import * as React from 'react';

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

  React.useEffect(() => {
    // The reader is remounted per node (keyed by id), so the initial 'loading'
    // state is fresh on every open — no synchronous reset needed here.
    let cancelled = false;
    const url = `/author/graph/text-resources?node_id=${encodeURIComponent(
      nodeId
    )}&space_id=${encodeURIComponent(spaceId)}`;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('read'))))
      .then((data: { body?: SerializedLexical | null }) => {
        if (!cancelled) {
          setState({ status: 'ready', body: data.body ?? null });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, spaceId]);

  return (
    <div className="bg-background absolute inset-0 z-10 flex flex-col">
      {/* reader toolbar — back + title */}
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <ArrowLeft className="size-4" aria-hidden />
          {t('graph.reader.back')}
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
