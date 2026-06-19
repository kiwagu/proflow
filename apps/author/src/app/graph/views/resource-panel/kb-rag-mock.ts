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

/**
 * Deterministic mock embed status keyed off the node id (no real vector index).
 * Most nodes read `indexed`; a deterministic minority read `stale`/`indexing` so
 * the prototype's reindex CYCLE is reachable for fidelity (owner directive Ф3 §3).
 * Pure function of the id — same node, same status, every render (no randomness).
 * When a real pipeline lands, replace this single call with the real read.
 */
export function mockEmbedStatus(nodeId?: string): MockEmbedStatus {
  if (!nodeId) {
    return 'indexed';
  }
  let hash = 0;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash = (hash * 31 + nodeId.charCodeAt(index)) >>> 0;
  }
  const bucket = hash % 10;
  if (bucket === 0) {
    return 'indexing';
  }
  if (bucket === 1 || bucket === 2) {
    return 'stale';
  }
  return 'indexed';
}

/** Why a link was suggested — the prototype's three heuristic signals. */
export type MockSuggestedReason = 'tag' | 'folder' | 'wording';

/** One mocked suggested link (a node to confirm/dismiss as a `relates_to` edge). */
export type MockSuggestedLink = {
  id: string;
  title: string;
  kind: string;
  /** Which signal surfaced it (drives the reason label). */
  reason: MockSuggestedReason;
  /** The shared-tag title when `reason === 'tag'` (for the reason label arg). */
  reasonTagTitle?: string;
};

const STOPWORD_MIN_LEN = 4;

/** Significant words of a title/description (prototype `similar` wording set). */
function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > STOPWORD_MIN_LEN)
  );
}

/**
 * Mocked suggested links — the prototype `similar()` heuristic, NOT a vector search
 * (no pgvector). Scores every candidate content node by THREE signals (owner
 * directive: broaden to the prototype's 3): shared TAG (×3, strongest), same
 * FOLDER (+2), and WORDING overlap (+1 per shared significant word). Returns the
 * top matches with the reason of the highest-weight signal. Deterministic (sorted
 * by score then title), capped. The CONFIRM stays a REAL `relates_to` write.
 */
export function mockSuggestedLinks(args: {
  nodeId: string;
  nodeTitle?: string;
  nodeDescription?: string;
  nodeFolderId?: string | null;
  tagsByItem: Record<string, ResourceTag[]>;
  titleById: ReadonlyMap<string, { title: string; kind: string }>;
  folderById?: ReadonlyMap<string, string | null>;
  descriptionById?: ReadonlyMap<string, string>;
  excludeIds: ReadonlySet<string>;
  max?: number;
}): MockSuggestedLink[] {
  const {
    nodeId,
    nodeTitle = '',
    nodeDescription = '',
    nodeFolderId = null,
    tagsByItem,
    titleById,
    folderById,
    descriptionById,
    excludeIds,
    max = 4,
  } = args;

  const myTags = new Set((tagsByItem[nodeId] ?? []).map((tag) => tag.id));
  const myWords = significantWords(`${nodeTitle} ${nodeDescription}`);

  const scored: (MockSuggestedLink & { score: number })[] = [];

  for (const [candidateId, candidate] of titleById.entries()) {
    if (candidateId === nodeId || excludeIds.has(candidateId)) {
      continue;
    }
    if (candidate.kind === 'folder' || candidate.kind === 'tag') {
      continue;
    }

    let score = 0;
    let reason: MockSuggestedReason | null = null;
    let reasonTagTitle: string | undefined;

    // shared tag — strongest signal (prototype ×3).
    const sharedTags = (tagsByItem[candidateId] ?? []).filter((tag) =>
      myTags.has(tag.id)
    );
    if (sharedTags.length > 0) {
      score += sharedTags.length * 3;
      reason = 'tag';
      reasonTagTitle = sharedTags[0].title;
    }

    // same folder (+2).
    const candidateFolder = folderById?.get(candidateId) ?? null;
    if (nodeFolderId && candidateFolder && candidateFolder === nodeFolderId) {
      score += 2;
      if (!reason) {
        reason = 'folder';
      }
    }

    // wording overlap (+1 per shared significant word).
    if (myWords.size > 0) {
      const candidateWords = significantWords(
        `${candidate.title} ${descriptionById?.get(candidateId) ?? ''}`
      );
      let overlap = 0;
      for (const word of candidateWords) {
        if (myWords.has(word)) {
          overlap += 1;
        }
      }
      if (overlap > 0) {
        score += overlap;
        if (!reason) {
          reason = 'wording';
        }
      }
    }

    if (score > 0 && reason) {
      scored.push({
        id: candidateId,
        title: candidate.title,
        kind: candidate.kind,
        reason,
        reasonTagTitle,
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, max)
    .map(({ id, title, kind, reason, reasonTagTitle }) => ({
      id,
      title,
      kind,
      reason,
      reasonTagTitle,
    }));
}
