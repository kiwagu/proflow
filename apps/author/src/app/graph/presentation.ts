import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  FileText,
  Folder,
  Link,
  Paperclip,
  PlayCircle,
  Tag,
  type LucideIcon,
} from 'lucide-react';

/**
 * Lens presentation mapping — kind → icon/label, owner label, and the single-line
 * media "meta" string the Drive cards show. No domain logic, no fetching — pure
 * mapping + i18n label resolution.
 */

/** kind → Lucide icon. Mirrors the prototype KIND_META (folder/text/file/video/link/tag). */
const KIND_ICON: Record<string, LucideIcon> = {
  folder: Folder,
  text: FileText,
  file: Paperclip,
  video: PlayCircle,
  link: Link,
  tag: Tag,
};

export function iconForKind(kind: string): LucideIcon {
  return KIND_ICON[kind] ?? FileText;
}

/** kind → i18n label via LITERAL keys (no dynamic-key indirection in views). */
export function kindLabel(t: GraphTranslator, kind: string): string {
  switch (kind) {
    case 'folder':
      return t('graph.kind.folder');
    case 'text':
      return t('graph.kind.text');
    case 'file':
      return t('graph.kind.file');
    case 'video':
      return t('graph.kind.video');
    case 'link':
      return t('graph.kind.link');
    case 'tag':
      return t('graph.kind.tag');
    default:
      return kind;
  }
}

/**
 * The display label for a node's owner (prototype `n.owner`, Drive meta line).
 * "You" when the current user owns it, "Member" for another known owner, and
 * "System" when there is no owner. RLS-safe: this is a display label only, never an
 * access decision; the real owner display NAME is not RLS-readable in this slice, so
 * we label the relation rather than invent a name.
 */
export function ownerLabel(
  t: GraphTranslator,
  ownerUserId: string | null | undefined,
  currentUserId: string | null | undefined
): string {
  if (!ownerUserId) {
    return t('graph.panel.ownerSystem');
  }
  if (currentUserId && ownerUserId === currentUserId) {
    return t('graph.panel.ownerYou');
  }
  return t('graph.panel.ownerMember');
}

/** Media meta the cards display (size / duration / link host). */
export type NodeMediaMeta = {
  byteSize?: number | null;
  durationMs?: number | null;
  mimeType?: string | null;
  linkHost?: string | null;
};

/** Format a byte size as a human label (prototype meta line). i18n-driven. */
function formatBytes(t: GraphTranslator, bytes: number): string {
  if (bytes < 1024) {
    return t('graph.media.bytes', { count: bytes });
  }
  if (bytes < 1024 * 1024) {
    return t('graph.media.kilobytes', { count: Math.round(bytes / 1024) });
  }
  return t('graph.media.megabytes', {
    count: Math.round((bytes / (1024 * 1024)) * 10) / 10,
  });
}

/** Format a duration (ms) as m:ss (prototype meta line). */
function formatDuration(t: GraphTranslator, ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return t('graph.media.duration', {
    minutes,
    seconds: String(seconds).padStart(2, '0'),
  });
}

/**
 * The single-line "meta" string a Drive card shows for a node: a link's HOST, a
 * file's SIZE, or a video's DURATION (prototype `n.meta`). Pure formatting over
 * already-loaded values; returns `null` when the kind carries no meta.
 */
export function formatNodeMeta(
  t: GraphTranslator,
  kind: string,
  media: NodeMediaMeta | undefined
): string | null {
  if (!media) {
    return null;
  }
  if (kind === 'link' && media.linkHost) {
    return media.linkHost;
  }
  if (kind === 'file' && media.byteSize != null) {
    return formatBytes(t, media.byteSize);
  }
  if (kind === 'video' && media.durationMs != null) {
    return formatDuration(t, media.durationMs);
  }
  return null;
}
