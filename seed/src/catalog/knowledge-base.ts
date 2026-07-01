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
 * Deterministic, few-KB fixture byte payloads for the KB media substrate (ADR-0026).
 * Plain text (an allowed mime — NOT in the denylist), so the e2e can round-trip the
 * EXACT bytes on download (assertion 2). Kept tiny — reference content, not a real
 * asset. Distinct contents per node so a download assertion can prove it fetched the
 * RIGHT object, not just any object.
 */
const FILE_FIXTURE_BYTES =
  'ProFlow KB media fixture — the generic file substrate (ADR-0026).\nThese bytes travel the real signed-upload transport into the private kb-media bucket.\nDownloaded via a short-lived signed URL; the same exact bytes come back.\n';
const VIDEO_FIXTURE_BYTES =
  'ProFlow KB media fixture — a "video" node over the SAME substrate (ADR-0026).\nOne generic satellite + one bucket serves file AND video; the player is a later slice.\n';

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
 *  - `kb/onboarding-title` ('Onboarding Guide') + `kb/onboarding-description`
 *      ('Workspace Setup', `onboarding` in its DESCRIPTION) ... the Phase-2 ranking pair:
 *      both match `onboarding`, but the title-match (title-prefix band) must outrank the
 *      description-match (description-prefix band) — title > description at equal tier.
 *
 * Deep-tree advanced search (the `?view=advanced` Pro-gated lens places each matched
 * leaf in its fully-expanded ancestor-folder tree, recursively, to ANY depth):
 *  - `kb/deep/level-1` … `kb/deep/level-5` (folders 'Level One' … 'Level Five') ⊃
 *      `kb/deep/leaf` ('Abyssal Treasure', `abyssal` in its DESCRIPTION) — a leaf SIX
 *      levels below the KB root. A search for `abyssal` matches only the leaf; the
 *      advanced view must render the whole nested path expanded down to the highlight.
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
    'A tagged slice of articles surfaced as a grid projection (tag membership = an incoming `tagged` walk), PLUS the lexical-search corpus (ADR-0024): a multi-locale match set (Cyrillic / accented / case-insensitive prefix / typo target), the RLS-absence proof (another user’s PRIVATE node stays absent; an ancestor-shared child is present for the grantee), and a six-level-deep folder chain (`abyssal` leaf) for deep-tree ADVANCED search. It ALSO carries the KB MEDIA substrate (ADR-0026): a real `file` + a real `video` node whose bytes are uploaded through the product’s signed-upload transport (a `kb-media` object + a `kmm` satellite both exist), a PRIVATE file owned by another user (the download RLS-negative), a file nested under the ancestor-shared folder (the inherited-grant positive), and a file per-user-granted to a node-only member who lacks space-wide update (the read/write asymmetry: the read-grant allows download but the write fence blocks upload).',
  presets: ['knowledge-base', 'search', 'media'],
  actors: [
    // A SECOND owner in the same space: owns the private-other-owner search negative
    // and is the grantee of the inherited-folder positive. `admin` role so base read
    // holds — the access DIMENSION (privacy / inheritance), not the verb, is the subject.
    { ref: 'searcherB', role: 'admin', displayName: 'Searcher Bea' },
    // A NODE-ONLY grantee for the media read/write asymmetry (ADR-0026, assertions
    // 11a/11b): a plain `member` (read + create, but NOT `space.knowledge.update`
    // space-wide). It receives a PER-USER READ grant on `kb/file-node-grant`. That grant
    // composes into the storage-RLS SELECT (download), so the grantee CAN read the bytes
    // (11a) — but the WRITE fence is owner-or-space-update and does NOT compose grants, so
    // the grantee is DENIED an upload URL (11b): a read-grantee cannot overwrite the bytes.
    { ref: 'mediaGrantee', role: 'member', displayName: 'Milo Media' },
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

        // ── KB media substrate: real file/video bytes (ADR-0026) ─────────────────
        // These nodes are made REAL through the product's OWN signed-upload transport:
        // the materializer authorizes an upload URL, PUTs `media.bytes` to the private
        // `kb-media` bucket via `uploadToSignedUrl`, then confirms the `kmm` satellite —
        // so a bucket object AND a satellite row both exist, fenced by the SAME
        // storage/satellite RLS as production (never a service-role/direct-SQL seed).
        {
          // Owned file — the functional happy path (assertions 1–3): owner uploads,
          // owner downloads the EXACT bytes, the ResourcePanel shows filename/size/mime.
          ref: 'kb/file-owned',
          kind: 'file',
          title: 'Media Handbook (file)',
          description: 'A real uploaded file — the KB media happy path.',
          media: {
            bytes: FILE_FIXTURE_BYTES,
            mimeType: 'text/plain',
            filename: 'media-handbook.txt',
          },
        },
        {
          // Owned video — assertion 4: the SAME substrate (one satellite + one bucket)
          // serves `video` too. The player is a later slice; upload/download is real now.
          ref: 'kb/video-owned',
          kind: 'video',
          title: 'Intro Clip (video)',
          description:
            'A real uploaded video — one substrate serves file & video.',
          media: {
            bytes: VIDEO_FIXTURE_BYTES,
            mimeType: 'text/plain',
            filename: 'intro-clip.txt',
          },
        },
        {
          // Read/write asymmetry (assertions 11a/11b): a REAL file owned by `admin`,
          // PER-USER granted to `mediaGrantee` (a plain `member` WITHOUT space-wide
          // `space.knowledge.update`). Its bytes are uploaded by the OWNER through the real
          // path (so a `kmm` row + object exist). The per-user grant is a READ-only
          // dimension:
          //  - DOWNLOAD (storage-RLS SELECT composes the grant) → the grantee CAN read the
          //    bytes (11a);
          //  - UPLOAD (the WRITE fence = owner-or-space-update, grants NOT composed) → the
          //    grantee is DENIED (11b) — a read-grantee must never overwrite another user's
          //    bytes. This is the write-fence regression guard.
          ref: 'kb/file-node-grant',
          kind: 'file',
          title: 'Node-Granted Read Target (file)',
          description:
            'A file per-user-granted to a node-only member — the read-grant allows download, the write fence blocks upload.',
          userGrants: ['mediaGrantee'],
          media: {
            bytes:
              'ProFlow KB media fixture — the OWNER uploaded these bytes; a read-grantee may DOWNLOAD but never OVERWRITE them (ADR-0026 write-fence).\n',
            mimeType: 'text/plain',
            filename: 'node-granted-read-target.txt',
          },
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

        // ── search corpus: the title>description ranking pair (ADR-0024 §3, Phase 2) ──
        // Two nodes that BOTH match `onboarding`, but at the SAME tier via DIFFERENT
        // fields: this node carries it in its TITLE (title-prefix), its sibling below
        // carries it as a description PREFIX (description-prefix). The banded scorer puts
        // title-prefix (500) strictly above description-prefix (300), so this node must
        // rank BEFORE its sibling — the assertion-5 proof. `onboarding` is a fresh term
        // that collides with no other corpus assertion (договор / egerie / GETTING / превет).
        {
          // TITLE match: `onboarding` is a prefix of 'Onboarding Guide' → title band.
          ref: 'kb/onboarding-title',
          kind: 'text',
          title: 'Onboarding Guide',
          description:
            'The TITLE carries the ranking term — this node must outrank the description-match.',
          tags: [KB_TAG],
          body: prose(
            'A short orientation for new teammates. This node exists to prove search ranking: a TITLE match outranks a DESCRIPTION match for the same query term at the same tier.'
          ),
        },
        {
          // DESCRIPTION match: 'onboarding' opens the DESCRIPTION body (description prefix),
          // while the TITLE deliberately avoids the term — so the only way this node matches
          // `onboarding` is via its description, ranking it BELOW the title-match above.
          ref: 'kb/onboarding-description',
          kind: 'text',
          title: 'Workspace Setup',
          description:
            'Onboarding new teammates starts here — the ranking term lives in the DESCRIPTION, not the title.',
          tags: [KB_TAG],
          body: prose(
            'Steps to configure a new workspace. The ranking term appears only in this node’s description, so a search for it ranks this node below the title-match sibling.'
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
            {
              // Inherited-grant DOWNLOAD positive (ADR-0026, assertion 8): a real file
              // owned by `admin`, nested under the folder shared to `searcherB`. Bea was
              // NEVER granted this file directly — only its ancestor folder — yet the
              // inherited-grant disjunct composes through the storage-RLS SELECT, so she
              // can mint a download URL and fetch the bytes. Bytes are seeded by the
              // OWNER (admin) through the real upload path.
              ref: 'kb/inherited-file',
              kind: 'file',
              owner: 'admin',
              title: 'Inherited Lease Attachment (file)',
              description:
                'A file inside the shared folder — Bea downloads it via inheritance.',
              media: {
                bytes:
                  'ProFlow KB media fixture — an attachment inherited through a shared ancestor folder (ADR-0023 + ADR-0026).\nThe grantee reaches these bytes with no direct grant on the file itself.\n',
                mimeType: 'text/plain',
                filename: 'inherited-lease-attachment.txt',
              },
            },
          ],
        },

        // ── deep-nested chain: advanced search renders the full ancestor tree ──────
        // The Advanced (Pro-gated) search lens places each matched leaf inside its
        // FULLY-EXPANDED ancestor-folder tree, recursively, to ANY depth (search = a
        // filtered KB). To exercise UNBOUNDED depth the corpus needs content several
        // folders deep: a five-folder chain `Level One → … → Level Five` containing a
        // single leaf doc whose DESCRIPTION holds the distinctive term `abyssal` — six
        // levels below the KB root. A search for `abyssal` (a term that collides with no
        // other corpus assertion) matches only the leaf; the Advanced view must then
        // render every ancestor folder on the path root → leaf, expanded, with the
        // snippet highlight on the leaf. The chain is nested via `children` (the same
        // `contain` create-vocabulary as the shallow corpus), never an inline spec tree.
        {
          ref: 'kb/deep/level-1',
          kind: 'folder',
          title: 'Level One',
          description:
            'Top of the deep chain — advanced search expands from here.',
          children: [
            {
              ref: 'kb/deep/level-2',
              kind: 'folder',
              title: 'Level Two',
              description: 'Second folder on the deep ancestor path.',
              children: [
                {
                  ref: 'kb/deep/level-3',
                  kind: 'folder',
                  title: 'Level Three',
                  description: 'Third folder on the deep ancestor path.',
                  children: [
                    {
                      ref: 'kb/deep/level-4',
                      kind: 'folder',
                      title: 'Level Four',
                      description: 'Fourth folder on the deep ancestor path.',
                      children: [
                        {
                          ref: 'kb/deep/level-5',
                          kind: 'folder',
                          title: 'Level Five',
                          description:
                            'Fifth (deepest) folder — directly contains the abyssal leaf.',
                          children: [
                            {
                              // The matched leaf: the term `abyssal` lives in its
                              // DESCRIPTION, six levels below the KB root. Searching
                              // `abyssal` finds only this node; Advanced view then
                              // renders Level One → … → Level Five expanded down to it.
                              ref: 'kb/deep/leaf',
                              kind: 'text',
                              title: 'Abyssal Treasure',
                              description:
                                'An abyssal treasure buried six levels deep in the folder chain.',
                              body: prose(
                                'This document sits six levels below the knowledge-base root, at the bottom of a five-folder chain.',
                                'It exists to exercise advanced (deep-tree) search: a query for "abyssal" matches only this leaf, and the advanced search lens must render every ancestor folder on the path from the root down to it, fully expanded, with the snippet highlight on this node.'
                              ),
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
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

    // ── media DOWNLOAD RLS-negative: another user's PRIVATE file (assertion 5) ───
    // A real file owned by `searcherB`, default (private) visibility, NO grant. Its
    // bytes DO exist in the bucket (uploaded by its owner through the real path), so a
    // failed download by `admin` proves the RLS byte fence — not a missing object.
    // `admin` (a non-grantee) gets NO satellite row → no signed URL; the object path
    // fetched directly also fails (storage-RLS mirrors node-read).
    {
      ref: 'kb/file-private-other',
      kind: 'file',
      owner: 'searcherB',
      title: 'Bea Private Attachment (file)',
      description:
        "Bea's private file — its bytes must NOT reach a non-grantee.",
      media: {
        bytes:
          'ProFlow KB media fixture — a PRIVATE file owned by another user (ADR-0026 assertion 5).\nThese bytes exist in the bucket but only the owner (or a grantee) may mint a signed URL.\n',
        mimeType: 'text/plain',
        filename: 'bea-private-attachment.txt',
      },
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
