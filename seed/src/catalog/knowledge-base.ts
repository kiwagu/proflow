import { prose } from './lexical.js';
import type { SeedScenario } from './types.js';

/**
 * KB ProjectionSpec — tag membership via an INCOMING `tagged` traversal that
 * starts at the tag node (Variant B; "has tag T" is a graph walk, not a column
 * filter). The scalar filter narrows to content kinds. Single source of truth for
 * both the seed and the e2e suites.
 */
export function buildKnowledgeBaseSpec(tagNodeId: string) {
  return {
    schema_version: 1,
    filter: { field: 'kind', op: 'in', value: ['text', 'link'] },
    traversal: {
      start: { ids: [tagNodeId] },
      relation_types: ['tagged'],
      direction: 'incoming',
      max_depth: 1,
      order_by: 'position',
    },
    view: 'grid',
  } as const;
}

const KB_TAG = 'Knowledge Base';

/**
 * Knowledge-base scenario — a tagged slice of articles surfaced as a grid. Shows
 * the canonical projection: tag content with one shared tag, then a saved KB
 * projection selects exactly the tagged nodes (an untagged article proves the
 * traversal selects, rather than returning everything).
 */
export const KNOWLEDGE_BASE_SCENARIO: SeedScenario = {
  id: 'knowledge-base',
  title: 'Knowledge base',
  summary:
    'A tagged slice of articles surfaced as a grid projection (tag membership = an incoming `tagged` walk).',
  presets: ['knowledge-base'],
  tree: [
    {
      ref: 'kb/folder',
      kind: 'folder',
      title: 'Knowledge Base',
      description: 'Reference articles, surfaced as a KB grid.',
      children: [
        {
          ref: 'kb/getting-started',
          kind: 'text',
          title: 'Getting Started',
          tags: [KB_TAG],
          starred: true,
          body: prose(
            'Welcome to the platform. This short guide walks you through your first space, your first resource, and how sharing works.',
            'Everything you create lives in a space. Inside a space you organize resources into folders, much like a familiar drive.',
            'A resource can be a document, a link, a file, or a video. Documents are written in a rich editor and published when they are ready to read.',
            'Everything you create is private until you deliberately share it — so you can draft in peace and publish only when you are happy with it.'
          ),
        },
        {
          ref: 'kb/sharing-model',
          kind: 'text',
          title: 'How Sharing Works',
          tags: [KB_TAG],
          openedBy: ['admin'],
          body: prose(
            'Access on the platform is fail-closed: new content is private to you by default. Nothing is shared until you choose to share it.',
            'Sharing is additive. You widen a resource’s audience by raising its floor — to your whole space — or by granting access to a specific group.',
            'Because the default errs closed, forgetting to share keeps content safe. It is never leaked by accident.',
            'You always keep access to your own content, and you can narrow the audience again at any time.'
          ),
        },
        {
          ref: 'kb/internal-draft',
          kind: 'text',
          title: 'Internal Draft (untagged)',
          description: 'Draft — left out of the KB on purpose.',
          draft: true,
          body: prose(
            'This article is intentionally left out of the knowledge base, so it never appears in the KB grid.',
            'It exists to prove two things at once: the projection selects by tag — only tagged articles show up — and a document can sit in the space as an unpublished draft.'
          ),
        },
      ],
    },
  ],
  projections: [
    {
      ref: 'kb/projection',
      appType: 'knowledge_base',
      name: 'Knowledge Base',
      view: 'grid',
      spec: (refs) => {
        const tagId = refs.get(`tag:${KB_TAG}`);
        if (!tagId) throw new Error('KB scenario: tag node not materialized');
        return buildKnowledgeBaseSpec(tagId);
      },
    },
  ],
};
