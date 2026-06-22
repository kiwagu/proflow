'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { cn } from '@workspace/ui/lib/utils';
import { ArrowLeft, Pencil } from 'lucide-react';
import * as React from 'react';

import { type Containment } from '@/app/graph/containment';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';

import { DocumentBodyView, type SerializedLexical } from './document-body-view';

/**
 * DocumentReader — the node-centric read-view for a `kind=text` node, opened from
 * Drive. Reads the REAL Lexical body through the RLS-gated body endpoint
 * (`GET /author/graph/text-resources`, ADR-0002 §2) and renders it read-only with
 * Payload's own `RichText` serializer (zero bespoke renderer).
 *
 * Read mode shows ONLY the latest PUBLISHED version — never a draft or an older
 * approved revision; a node with no published version yet shows an honest "not
 * published" notice (its draft stays reachable from Details → Edit). So a
 * double-click never surfaces un-approved material.
 *
 * Editing happens on a dedicated route (`/author/doc/[nodeId]`) that mounts
 * Payload's FULL editor under its own provider environment (`RootLayout` +
 * `RenderLexical`) — no admin nav. "Edit" navigates there; on return the reader
 * refetches (window focus) so a just-published body shows.
 */

type ReaderState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      body: SerializedLexical | null;
      docStatus: string | null;
      /** Whether a published version exists — read mode shows ONLY that. */
      published: boolean;
    };

export function DocumentReader({
  spaceId,
  nodeId,
  title,
  messages,
  containment,
  onClose,
  onEdit,
  onMutated,
  preparingEdit = false,
}: {
  spaceId: string;
  nodeId: string;
  title: string;
  messages: Record<string, string>;
  /** Containment forest — the `⋯` menu's Move folder picker needs it. */
  containment: Containment;
  onClose: () => void;
  /** Launch the editor (the workbench's shared seed-choice flow). */
  onEdit: () => void;
  /** Re-resolve the canvas after a `⋯` action (rename / move / delete). */
  onMutated: () => void;
  /** The launcher is fetching versions to decide the seed — disable Edit. */
  preparingEdit?: boolean;
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
        published?: boolean;
      };
      if (mounted.current) {
        setState({
          status: 'ready',
          body: data.body ?? null,
          docStatus: data.status ?? null,
          published: data.published ?? false,
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
          onClick={onEdit}
          disabled={state.status !== 'ready' || preparingEdit}
        >
          <Pencil className="size-4" aria-hidden />
          {t('graph.reader.edit')}
        </Button>

        {/* Document actions (rename / move / delete). A delete closes the reader. */}
        <NodeActionsMenu
          spaceId={spaceId}
          t={t}
          node={{ id: nodeId, kind: 'text', title }}
          containment={containment}
          onMutated={onMutated}
          onActed={onClose}
        />
      </div>

      {/* reading column — the shared read-mode container */}
      <div className="min-h-0 flex-1 overflow-auto">
        {state.status === 'loading' ? (
          <p className="text-muted-foreground mx-auto max-w-[720px] px-6 py-10 text-sm">
            {t('graph.reader.loading')}
          </p>
        ) : state.status === 'error' ? (
          <p
            role="alert"
            className="text-destructive mx-auto max-w-[720px] px-6 py-10 text-sm"
          >
            {t('graph.reader.error')}
          </p>
        ) : !state.published ? (
          // No published version yet — read mode never shows the draft. The
          // content stays reachable for editing via Details → Edit.
          <p className="text-muted-foreground mx-auto max-w-[720px] px-6 py-10 text-sm">
            {t('graph.reader.unpublished')}
          </p>
        ) : (
          <DocumentBodyView
            title={title}
            body={state.body}
            emptyLabel={t('graph.reader.empty')}
          />
        )}
      </div>
    </div>
  );
}
