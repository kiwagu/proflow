import type { Neighbor } from '@workspace/knowledge-contracts';
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
 * Lens presentation mapping (slice-09 §2.3 / §3.1). The engine returns a flat,
 * taxonomy-AGNOSTIC `neighbors[]` carrying `relation_type` + `direction`. KNOWING
 * that `relates_to` means "related", `tagged` (outgoing) means "tags", `part_of`
 * (outgoing) means "parent", and `tagged` (incoming, read from a tag node) means
 * "tagged-by" is the PRESENTATION's job — it lives here, never in the engine.
 *
 * No domain logic, no fetching — pure mapping + i18n label resolution.
 */

/** kind → Lucide icon (1.5px stroke is the library default we render). Mirrors
 * the prototype KIND_META (folder/text/file/video/link/tag). */
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

/** The presentation buckets a neighbor falls into (§2.3 / §4 note). */
export type RelationGroup = 'related' | 'tags' | 'parent' | 'taggedBy';

export function groupForNeighbor(neighbor: Neighbor): RelationGroup {
  if (neighbor.relation_type === 'relates_to') {
    return 'related';
  }
  if (neighbor.relation_type === 'part_of') {
    // outgoing part_of from a content node → its parent (child part_of parent).
    return neighbor.direction === 'outgoing' ? 'parent' : 'related';
  }
  // tagged: outgoing from a content node → its tags; incoming (read from a tag
  // node) → the resources tagged by it.
  return neighbor.direction === 'outgoing' ? 'tags' : 'taggedBy';
}

/**
 * relation_type → i18n key segment. The catalog keys are camelCase (dotted-key
 * format disallows underscores), while relation_types are snake_case data; this
 * thin map bridges them so labels stay data-driven, never hardcoded.
 */
const RELATION_KEY: Record<string, string> = {
  relates_to: 'relatesTo',
  tagged: 'tagged',
  part_of: 'partOf',
  contains: 'contains',
  shortcut: 'shortcut',
};

/** i18n label for a relation_type (data-driven; never a hardcoded string). */
export function relationLabel(
  t: GraphTranslator,
  relationType: string
): string {
  return t(`graph.relation.${RELATION_KEY[relationType] ?? relationType}`);
}

/** Badge variant for a status (prototype STATUS_META — approved is the strong
 * solid `default`, everything else is a hairline `outline`/`secondary`). */
type StatusBadgeVariant = 'default' | 'secondary' | 'outline';

/** A status mapped to its human label + Badge variant (prototype STATUS_META,
 * §cross-cutting). One source of truth used by the lens cards + the panel + the
 * status transition buttons, so a raw `in_review` never leaks into the UI. */
export type StatusMeta = {
  label: string;
  variant: StatusBadgeVariant;
};

/** Known workflow statuses → Badge variant (prototype STATUS_META keys 1:1). */
const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  active: 'secondary',
  approved: 'default',
  in_review: 'outline',
  draft: 'outline',
  archived: 'outline',
};

/** status → i18n label via LITERAL keys (no dynamic-key indirection in views). */
function statusLabel(t: GraphTranslator, status: string): string {
  switch (status) {
    case 'active':
      return t('graph.status.active');
    case 'approved':
      return t('graph.status.approved');
    case 'in_review':
      return t('graph.status.inReview');
    case 'draft':
      return t('graph.status.draft');
    case 'archived':
      return t('graph.status.archived');
    default:
      return status;
  }
}

/**
 * Map a raw status to its display label + Badge variant (prototype STATUS_META).
 * Returns `null` for an unknown/empty status so callers render NO badge rather
 * than an empty pill (prototype: `STATUS_META[status]` may be undefined).
 */
export function statusMeta(
  t: GraphTranslator,
  status: string | null | undefined
): StatusMeta | null {
  if (!status || !(status in STATUS_VARIANT)) {
    return null;
  }
  return { label: statusLabel(t, status), variant: STATUS_VARIANT[status] };
}

/** The ordered status set offered as transition targets (prototype panel). */
export const TRANSITIONABLE_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'active',
] as const;

/**
 * The display label for a node's owner (prototype `n.owner`, panel/Drive meta).
 * "You" when the current user owns it, "Member" for another known owner, and
 * "System" when there is no owner (prototype `owner !== "—" ? owner : "System"`).
 * RLS-safe: this is a display label only, never an access decision; the real
 * owner display NAME is not RLS-readable in this slice, so we label the relation
 * rather than invent a name (MOCK-name path, owner directive).
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

/** Two-letter initials for an owner avatar (prototype `initials`). */
export function ownerInitials(label: string): string {
  return (
    label
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

/** Media meta the cards/panel display (size / duration / link host). */
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
 * The single-line "meta" string a Drive card / panel header shows for a node:
 * a link's HOST, a file's SIZE, or a video's DURATION (prototype `n.meta`). Pure
 * formatting over already-loaded values; returns `null` when the kind carries no
 * meta. The caller supplies the (possibly MOCK-filled) byte/duration values.
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
