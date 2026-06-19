import type { Neighbor } from '@workspace/knowledge-contracts';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  FileText,
  Folder,
  Link2,
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
  link: Link2,
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
