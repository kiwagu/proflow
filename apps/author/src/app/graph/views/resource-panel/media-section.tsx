import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { MediaDownloadResponse } from '@workspace/knowledge-contracts';
import { Button } from '@workspace/ui/components/button';
import { Download, Paperclip } from 'lucide-react';
import * as React from 'react';

import { formatBytes } from '@/app/graph/presentation';
import type { KbAttributes } from '@/app/graph/graph-data.types';

import { PanelSectionLabel } from './panel-section-label';
import { postJson } from './panel-fetch';

/**
 * MediaSection — the READ-side "Media" summary in the ResourcePanel (ADR-0026, the
 * reserved media-section note in `resource-panel.tsx`, now realized). Rendered ONLY
 * when the node has confirmed bytes (`attributes.media` present — a `kb.resource_media_meta`
 * row); a node with no satellite carries no `media` and the section is omitted
 * (poc-no-fallbacks, no mock). It shows the original filename, humanized size, and
 * mime type, plus a Download button.
 *
 * Download egress is server-authorized + short-lived (ADR-0026 §2c): each click
 * POSTs `media?op=download-url {spaceId,nodeId}`, the server authorizes node-read
 * under the caller's RLS and mints a fresh signed URL, and the client navigates to
 * it. The URL is NEVER cached — re-minted per click (short TTL). RLS is the sole
 * fence; a denied caller gets no URL (null) → a disabled/errored state, never a leak.
 *
 * Purely presentational: no per-kind preview/player (Phase 2). Layout mirrors the
 * Access / Description section idioms (PanelSectionLabel + a muted meta line).
 */
export function MediaSection({
  t,
  spaceId,
  nodeId,
  media,
}: {
  t: GraphTranslator;
  spaceId: string;
  nodeId: string;
  media: NonNullable<KbAttributes['media']>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);

  const size = media.byteSize != null ? formatBytes(t, media.byteSize) : null;

  async function onDownload() {
    setBusy(true);
    setError(false);
    // Re-mint the signed URL every click (short TTL, never cached) — the server
    // authorizes node-read under RLS and returns the URL, or null on denial.
    const result = await postJson<MediaDownloadResponse>(
      '/author/graph/media?op=download-url',
      { spaceId, nodeId }
    );
    setBusy(false);
    if (!result?.signedUrl) {
      setError(true);
      return;
    }
    // Navigate to the signed URL to fetch the bytes directly from Storage.
    window.location.assign(result.signedUrl);
  }

  return (
    <section className="flex flex-col gap-2.5">
      <PanelSectionLabel>
        <Paperclip className="size-3" aria-hidden />
        {t('graph.media.section')}
      </PanelSectionLabel>

      <div className="flex flex-col gap-1">
        <span
          className="truncate text-sm font-medium"
          title={media.originalFilename}
        >
          {media.originalFilename}
        </span>
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {size ? <span>{size}</span> : null}
          {size ? <span aria-hidden>·</span> : null}
          <span className="truncate">{media.mimeType}</span>
        </div>
      </div>

      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={onDownload}
          disabled={busy}
          className="mt-0.5"
        >
          <Download className="size-4" aria-hidden />
          {busy ? t('graph.media.downloading') : t('graph.media.download')}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {t('graph.media.downloadError')}
        </p>
      ) : null}
    </section>
  );
}
