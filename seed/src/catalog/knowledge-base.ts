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
 * Knowledge-base scenario — a tagged slice of articles surfaced as a grid, AND the
 * lexical-search corpus (slice-12, ADR-0024). The KB grid shows the canonical
 * projection (tag content with one shared tag, then a saved KB projection selects
 * exactly the tagged nodes; an untagged article proves the traversal selects rather
 * than returning everything). Layered on top is the SEARCH corpus: a multi-locale set
 * of titled nodes that exercise every Phase-1 match class and the RLS-absence proof.
 *
 * Search corpus (consumed by `knowledge-search.e2e.spec.ts`, ADR-0024 §3):
 *  - `kb/getting-started` ('Getting Started') ........ case-insensitive prefix vs 'GETTING'.
 *  - `kb/lease-cyrillic` ('Договор аренды') .......... Cyrillic + case-insensitive prefix.
 *  - `kb/egerie-accent` ('Égérie') ................... accent fold (`unaccent`).
 *  - `kb/greeting-typo` ('Привет команде') ........... the Phase-2 `'превет'` fuzzy target
 *      (the NODE is seeded now so the corpus is complete; the typo ASSERTION is Phase 2).
 *
 * RLS-absence corpus (the security proof, ADR-0024 §6/§8 — RLS is the SOLE fence):
 *  - `kb/private-other-owner` ('Договорённость приватная', owned by `searcherB`, NO grant)
 *      — a PRIVATE node owned by ANOTHER user; must be ABSENT from `admin`'s search even
 *      though its title prefix-matches `договор` (assertion 6). Owner-scoped, fail-closed.
 *  - `kb/inherited-folder` ⊃ `kb/inherited-child` ('Договор унаследованный', owned by
 *      `admin`, the folder shared → `searcherB` via a per-user grant) — the inherited-grant
 *      disjunct (ADR-0023): `searcherB` cannot see the child directly, but the ANCESTOR
 *      folder grant makes it visible, so it PRESENT in `searcherB`'s search (assertion 8).
 *
 * The ANOTHER-SPACE node (assertion 7) is NOT expressible in this single-space scenario
 * model — it is built in the e2e fixture's second tenant (the spec's own machinery), since
 * a catalog scenario is scoped to one space.
 *
 * Actors: `searcherB` (a second `admin` in the SAME space) owns the private-other-owner
 * node and is the grantee of the inherited folder. Both `admin` and `searcherB` hold the
 * base read role; the access DIMENSION (private vs inherited grant) is the subject.
 */
export const KNOWLEDGE_BASE_SCENARIO: SeedScenario = {
  id: 'knowledge-base',
  title: 'Knowledge base',
  summary:
    'A tagged slice of articles surfaced as a grid projection (tag membership = an incoming `tagged` walk), PLUS the lexical-search corpus (ADR-0024): a multi-locale match set (Cyrillic / accented / case-insensitive prefix / typo target) and the RLS-absence proof (another user’s PRIVATE node stays absent; an ancestor-shared child is present for the grantee).',
  presets: ['knowledge-base', 'search'],
  actors: [
    // A SECOND owner in the same space: owns the private-other-owner search negative
    // and is the grantee of the inherited-folder positive. `admin` role so base read
    // holds — the access DIMENSION (privacy / inheritance), not the verb, is the subject.
    { ref: 'searcherB', role: 'admin', displayName: 'Searcher Bea' },
  ],
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

        // ── search corpus: the multi-locale match set (ADR-0024 §3) ──────────────
        {
          // Cyrillic + case-insensitive prefix: `договор` finds it (assertion 1).
          ref: 'kb/lease-cyrillic',
          kind: 'text',
          title: 'Договор аренды',
          description:
            'A Cyrillic-titled article — search must find it case-folded.',
          tags: [KB_TAG],
          body: prose(
            'Этот документ описывает условия договора аренды помещения.',
            'Его заголовок на кириллице — поиск находит его по префиксу без учёта регистра, что доказывает работу нормализации для не-латинских алфавитов.'
          ),
        },
        {
          // Accent fold via `unaccent`: `egerie` (no accents) finds 'Égérie' (assertion 2).
          ref: 'kb/egerie-accent',
          kind: 'text',
          title: 'Égérie',
          description:
            'An accented title — search folds the accents (unaccent).',
          tags: [KB_TAG],
          body: prose(
            'An accented title proves the search normalizer folds diacritics: a query for "egerie" (no accents) still matches "Égérie".'
          ),
        },
        {
          // The Phase-2 fuzzy target: `'превет'` (a typo) → 'Привет команде' via pg_trgm.
          // The NODE is seeded NOW so the corpus is complete; the typo ASSERTION is Phase 2.
          ref: 'kb/greeting-typo',
          kind: 'text',
          title: 'Привет команде',
          description:
            'A Cyrillic greeting — the Phase-2 typo-tolerance target.',
          tags: [KB_TAG],
          body: prose(
            'A friendly Cyrillic greeting to the team. Seeded as the typo-tolerance target: a fuzzy query like "превет" should find "Привет" once the Phase-2 trigram tier lands.'
          ),
        },

        // ── inherited-grant positive (ADR-0023 disjunct through search, assertion 8) ──
        {
          // A's folder, shared per-user to `searcherB`. Its OWN child inherits the grant,
          // so `searcherB` (who was never granted the child directly) finds the child in
          // search via the ancestor folder grant — the inheritance composes through search.
          ref: 'kb/inherited-folder',
          kind: 'folder',
          owner: 'admin',
          title: 'Shared Lease Folder',
          description:
            'A folder A shares with Searcher Bea — its own child inherits.',
          userGrants: ['searcherB'],
          children: [
            {
              ref: 'kb/inherited-child',
              kind: 'text',
              owner: 'admin',
              title: 'Договор унаследованный',
              description:
                "A's own doc inside the shared folder — Bea sees it only via inheritance.",
              body: prose(
                'Этот договор лежит внутри папки, которой со мной поделились, поэтому я вижу его по наследованию — даже без прямого доступа к самому документу.',
                'Поиск наследует ту же модель доступа: документ находится в результатах того, кому папка была предоставлена, — наследуемая выдача проходит через поиск.'
              ),
            },
          ],
        },
      ],
    },

    // ── RLS-absence negative: another user's PRIVATE node (assertion 6) ──────────
    // Owned by `searcherB`, default (private) visibility, NO grant/scope/floor and NOT
    // filed into any shared folder. Its title prefix-matches `договор`, so it would be a
    // search HIT for its owner — but for `admin` (a non-grantee) it must be ABSENT: RLS is
    // the fence, not any app-level filter. (Additive-inert: a private unshared node owned by
    // another user is invisible to everyone but its owner, so it changes no other outcome.)
    {
      ref: 'kb/private-other-owner',
      kind: 'text',
      owner: 'searcherB',
      title: 'Договорённость приватная',
      description:
        "Bea's private note — must NOT appear in another user's search.",
      body: prose(
        'Это приватная договорённость, принадлежащая другому пользователю. Никому не предоставлен доступ, ничего не опубликовано.',
        'Её заголовок совпадает по префиксу с поисковым запросом, но для не-владельца она отсутствует в результатах: фильтрует строки RLS, а не прикладной фильтр.'
      ),
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
