import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  DescriptionList,
  type DescriptionListItem,
} from '@workspace/ui/components/description-list';

import type { KbAttributes } from '@/app/graph/graph-data.types';
import { formatBytes, mediaTypeLabel } from '@/app/graph/presentation';

/**
 * MediaFacts — the SINGLE source for a file/video node's metadata view (Type / Size /
 * Filename) from the `kb.resource_media_meta` satellite. Rendered identically
 * everywhere a media node appears — the Drive/search cards (`item-card`) and the
 * ResourcePanel (`media-section`) — so the media presentation lives in ONE place.
 *
 * The LAYOUT is the generic, i18n-free `DescriptionList` primitive from `@workspace/ui`;
 * this thin app wrapper only maps media fields → resolved labels (`graph.media.*`) and
 * values (the shared `mediaTypeLabel`/`formatBytes` formatters). A field that is absent
 * is omitted (no mock fill — poc-no-fallbacks); an empty set renders nothing.
 */
export function MediaFacts({
  t,
  media,
  className,
}: {
  t: GraphTranslator;
  media: NonNullable<KbAttributes['media']>;
  className?: string;
}) {
  const items: DescriptionListItem[] = [];
  if (media.mimeType) {
    items.push({
      label: t('graph.media.type'),
      value: mediaTypeLabel(media.mimeType),
      valueTitle: media.mimeType,
      truncate: true,
    });
  }
  if (media.byteSize != null) {
    items.push({
      label: t('graph.media.size'),
      value: formatBytes(t, media.byteSize),
    });
  }
  if (media.originalFilename) {
    items.push({
      label: t('graph.media.filename'),
      value: media.originalFilename,
      valueTitle: media.originalFilename,
      truncate: true,
    });
  }
  return <DescriptionList items={items} className={className} />;
}
