import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { MediaDownloadResponse } from '@workspace/knowledge-contracts';
import { Skeleton } from '@workspace/ui/components/skeleton';
import * as React from 'react';

import type { KbAttributes } from '@/app/graph/graph-data.types';

import { postJson } from './panel-fetch';

/**
 * MediaPreview — the inline, MIME-driven preview shown ABOVE the MediaFacts in the
 * ResourcePanel Media section (ADR-0026 Phase 2, increment 1). The preview is chosen
 * from `media.mimeType`, NOT the node kind: `image/*` → an inline `<img>`,
 * `application/pdf` → a bounded inline `<iframe>`. Any other mime → no preview at all
 * (the caller renders only facts + Download).
 *
 * Egress reuses the SAME short-lived, server-authorized download authorizer as the
 * Download button (`media?op=download-url {spaceId,nodeId}`) — NO public URL, no new
 * endpoint. One URL is minted per node ON MOUNT and loaded once (`loading="lazy"` /
 * single iframe load), so the ~60s TTL is sufficient. RLS is the sole fence: a denied
 * node resolves to null → NO preview is rendered, never a leak (poc-no-fallbacks: a
 * real signed-URL render or nothing).
 */
export function MediaPreview({
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
  const kind = previewKind(media.mimeType);
  // The mint result is TAGGED with the `nodeId` it resolved, so a result is only
  // trusted for the node currently shown — while it is null or tagged to a previous
  // node the preview is still in flight (a fresh mint runs from the effect). This
  // keys the loading state off the node identity, so no synchronous reset in the
  // effect is needed. `error: true` = RLS denial / expiry / load failure.
  const [resolved, setResolved] = React.useState<{
    nodeId: string;
    signedUrl?: string;
    error?: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (!kind) {
      return;
    }
    let active = true;
    void (async () => {
      const result = await postJson<MediaDownloadResponse>(
        '/author/graph/media?op=download-url',
        { spaceId, nodeId }
      );
      if (!active) {
        return;
      }
      setResolved(
        result?.signedUrl
          ? { nodeId, signedUrl: result.signedUrl }
          : { nodeId, error: true }
      );
    })();
    return () => {
      active = false;
    };
  }, [kind, spaceId, nodeId]);

  // A result is only current if it is tagged to the node being shown.
  const current = resolved?.nodeId === nodeId ? resolved : null;

  // Non-previewable mime, or the URL could not be minted (RLS denial / expiry /
  // error): render nothing — facts + Download remain the whole section.
  if (!kind || current?.error) {
    return null;
  }

  if (!current?.signedUrl) {
    return <Skeleton className="h-40 w-full rounded-md" />;
  }

  const signedUrl = current.signedUrl;
  const label = t('graph.media.previewAlt', { name: media.originalFilename });

  if (kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={signedUrl}
        alt={label}
        loading="lazy"
        onError={() => setResolved({ nodeId, error: true })}
        className="bg-muted max-h-64 w-full rounded-md border object-contain"
      />
    );
  }

  return (
    <iframe
      src={signedUrl}
      title={label}
      onError={() => setResolved({ nodeId, error: true })}
      className="bg-muted h-96 w-full rounded-md border"
    />
  );
}

/**
 * previewKind — the MIME → preview-element decision. `image/*` and `application/pdf`
 * are the only previewable families in this increment; everything else (video, audio,
 * office docs, unknown) returns null → no preview.
 */
function previewKind(mimeType: string | null): 'image' | 'pdf' | null {
  if (!mimeType) {
    return null;
  }
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  return null;
}
