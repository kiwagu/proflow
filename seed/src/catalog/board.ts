import type { SeedScenario } from './types.js';

const DOCS_TAG = 'Docs';

/**
 * Board ProjectionSpec — selects document nodes (incoming `tagged` walk from the
 * 'Docs' tag) and DECLARES a `requires_state` gating rule: a node is available iff
 * its status is in `{ approved }`. Gating is DISPLAY-only — every node stays in
 * `items`; only `available` changes. Single source of truth for seed + e2e.
 */
export function buildBoardSpec(docsTagNodeId: string) {
  return {
    schema_version: 1,
    filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
    traversal: {
      start: { ids: [docsTagNodeId] },
      relation_types: ['tagged'],
      direction: 'incoming',
      max_depth: 1,
      order_by: 'title',
    },
    view: 'board',
    gating: { rule: 'requires_state', params: { allowed: ['approved'] } },
  } as const;
}

/**
 * Document-review board scenario — three documents at distinct workflow statuses
 * (draft / in_review / approved), surfaced as a status board where a gating rule
 * marks only approved docs available. Pure configuration over the one graph: no
 * new tables, no resolver fork — the third app type as data.
 */
export const BOARD_SCENARIO: SeedScenario = {
  id: 'board',
  title: 'Document review board',
  summary:
    'Documents at distinct workflow statuses on a board; a `requires_state` rule gates availability to approved docs (display gating, not access).',
  presets: ['board'],
  tree: [
    {
      ref: 'board/folder',
      kind: 'folder',
      title: 'Documents',
      description: 'Policies and proposals moving through review.',
      children: [
        {
          ref: 'board/draft',
          kind: 'text',
          title: 'Doc A — Draft Proposal',
          status: 'draft',
          workflowKey: 'document_review',
          tags: [DOCS_TAG],
        },
        {
          ref: 'board/in-review',
          kind: 'text',
          title: 'Doc B — Under Review',
          status: 'in_review',
          workflowKey: 'document_review',
          tags: [DOCS_TAG],
        },
        {
          ref: 'board/approved',
          kind: 'text',
          title: 'Doc C — Approved Policy',
          status: 'approved',
          workflowKey: 'document_review',
          tags: [DOCS_TAG],
          starred: true,
        },
      ],
    },
  ],
  projections: [
    {
      ref: 'board/projection',
      appType: 'knowledge_base',
      name: 'Documents',
      view: 'board',
      spec: (refs) => {
        const tagId = refs.get(`tag:${DOCS_TAG}`);
        if (!tagId)
          throw new Error('Board scenario: Docs tag not materialized');
        return buildBoardSpec(tagId);
      },
    },
  ],
};
