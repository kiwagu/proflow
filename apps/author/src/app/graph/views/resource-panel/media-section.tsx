import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { MediaDownloadResponse } from '@workspace/knowledge-contracts';
import { Button } from '@workspace/ui/components/button';
import { Download } from 'lucide-react';
import * as React from 'react';

import type { KbAttributes } from '@/app/graph/graph-data.types';
import { iconForMedia } from '@/app/graph/presentation';
import { MediaFacts } from '@/app/graph/views/media-facts';

import { MediaPreview } from './media-preview';
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
 * An inline MIME-driven preview (ADR-0026 Phase 2, increment 1) renders ABOVE the
 * facts for `image/*` and `application/pdf` via `MediaPreview` (reusing the SAME
 * download-authorize URL); any other mime shows no preview. The facts (type / size /
 * filename) render through the shared `MediaFacts` — the SAME view the Drive/search
 * cards use — so the media presentation has one source; the panel adds the section
 * label (with the type-aware icon) + the Download action around it.
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
        {React.createElement(iconForMedia('file', media.mimeType), {
          className: 'size-3',
          'aria-hidden': true,
        })}
        {t('graph.media.section')}
      </PanelSectionLabel>

      <MediaPreview t={t} spaceId={spaceId} nodeId={nodeId} media={media} />

      <MediaFacts t={t} media={media} />

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
