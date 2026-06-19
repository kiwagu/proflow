// MOCK — pending vector backend (slice-11), for owner discussion.
//
// RAG-3 (embed status / reindex / suggested links / semantic `similar`) needs a
// vector pipeline that does NOT exist (pgvector is not in the self-hosted Supabase
// image — ADR-0014 §5). The prototype renders these three affordances; to reach
// pixel-1:1 NOW and surface the gap for the owner, this module returns DETERMINISTIC
// stubs explicitly marked as mocks (owner directive Ф3 §2/§3, relaxing
// poc-no-fallbacks ONLY for these clearly-labelled stubs — never silent fakes).
//
// What is mocked here (and ONLY here):
//   • embed status — fixed `'indexed'` (no real index; the panel labels it mocked).
//   • suggested links — a CLIENT-SIDE shared-tag HEURISTIC, not a vector similarity
//     search. This mirrors the prototype's own `similar()` (which was likewise a
//     heuristic, not a vector). It surfaces resources that share a tag with the
//     open node, so the confirm/dismiss UI is exercised against real graph data.
//
// Everything ELSE in the panel (description/tags/provenance/views/health/
// connections/parent) is REAL (landed satellites + neighborhood). When a vector
// backend lands, delete this file and read the real status/similar — the panel
// shape does not change.

import type { ResourceTag } from '@/app/graph/graph-page.data';

/** The mocked embed-index status of a node's description. */
export type MockEmbedStatus = 'indexed' | 'stale' | 'indexing';

/** Deterministic mock embed status — always `indexed` (no real vector index). */
export function mockEmbedStatus(): MockEmbedStatus {
  return 'indexed';
}

/** One mocked suggested link (a node to confirm/dismiss as a `relates_to` edge). */
export type MockSuggestedLink = {
  id: string;
  title: string;
  kind: string;
  /** Why it was suggested — the shared-tag heuristic reason (i18n key + arg). */
  reasonTagTitle: string;
};

/**
 * Mocked suggested links for a node — a CLIENT-SIDE shared-tag heuristic over the
 * already-loaded tag map (NOT a vector search). Returns content nodes that share at
 * least one tag with the open node, excluding the node itself and nodes already
 * linked to it. Deterministic (sorted by shared-tag count then title), capped.
 */
export function mockSuggestedLinks(args: {
  nodeId: string;
  tagsByItem: Record<string, ResourceTag[]>;
  titleById: Map<string, { title: string; kind: string }>;
  excludeIds: ReadonlySet<string>;
  max?: number;
}): MockSuggestedLink[] {
  const { nodeId, tagsByItem, titleById, excludeIds, max = 4 } = args;
  const myTags = new Set((tagsByItem[nodeId] ?? []).map((tag) => tag.id));
  if (myTags.size === 0) {
    return [];
  }

  const scored: {
    id: string;
    title: string;
    kind: string;
    reasonTagTitle: string;
    shared: number;
  }[] = [];

  for (const [candidateId, candidateTags] of Object.entries(tagsByItem)) {
    if (candidateId === nodeId || excludeIds.has(candidateId)) {
      continue;
    }
    const node = titleById.get(candidateId);
    if (!node || node.kind === 'folder' || node.kind === 'tag') {
      continue;
    }
    const sharedTags = candidateTags.filter((tag) => myTags.has(tag.id));
    if (sharedTags.length === 0) {
      continue;
    }
    scored.push({
      id: candidateId,
      title: node.title,
      kind: node.kind,
      reasonTagTitle: sharedTags[0].title,
      shared: sharedTags.length,
    });
  }

  return scored
    .sort((a, b) => b.shared - a.shared || a.title.localeCompare(b.title))
    .slice(0, max)
    .map(({ id, title, kind, reasonTagTitle }) => ({
      id,
      title,
      kind,
      reasonTagTitle,
    }));
}
