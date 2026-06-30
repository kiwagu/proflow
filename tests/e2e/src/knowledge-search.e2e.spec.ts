/**
 * Lexical search — the full match matrix (prefix + fuzzy/ranking) + the RLS-absence proof
 * (ADR-0024, slice-12; the merge gate). Search is a SUBSTRATE capability, a SIBLING of
 * projection-resolve:
 * the browser POSTs only a `term` + `spaceId` to `/author/graph/search`; the server
 * compiles + runs the SELECT AS THE USER (the SAME RLS transport projection-resolve
 * reuses — ADR-0009), so Postgres RLS is the SOLE access fence (ADR-0024 §6). There is
 * NO app-level status/visibility filter doing the fencing — a private / other-space node
 * is absent because RLS never returns it, not because an app filter dropped it.
 *
 * The corpus comes from the SHARED `KNOWLEDGE_BASE_SCENARIO` catalog entry (via
 * `seedSearchCorpusFixture`), so the demo seed and this test build the multi-locale match
 * set + the RLS-absence proof the SAME way, through the one `/author/graph/*` create-
 * vocabulary (`createDoc`/`describe`/`grantUser`/`contain`). The search itself runs through
 * the SAME vocabulary (`seedClientFor(actor).search` → the REAL route, RLS-fenced as the
 * acting user), so a hit's presence/absence is the live runtime truth, not a unit stub.
 *
 * Full match matrix (Phase 1 rows 1–3, 6–8 + the Phase-2 fuzzy/ranking rows 4–5; all run
 * through the SAME RLS-fenced route, drawing from the SAME shared corpus):
 *
 *  | # | Query       | Expected                            | Verifies                            |
 *  |---|-------------|-------------------------------------|-------------------------------------|
 *  | 1 | договор     | 'Договор аренды' PRESENT            | Cyrillic + case-insensitive prefix  |
 *  | 2 | egerie      | 'Égérie' PRESENT                    | accent fold (unaccent)              |
 *  | 3 | GETTING     | 'Getting Started' PRESENT           | case-insensitive prefix             |
 *  | 4 | превет      | 'Привет команде' PRESENT            | pg_trgm word_similarity (typo)      |
 *  | 5 | onboarding  | TITLE-match ranks BEFORE desc-match | banded scorer: title > description  |
 *  | 6 | договор     | Bea's PRIVATE node ABSENT (admin)   | RLS is the fence, not an app filter |
 *  | 7 | договор     | another SPACE's node ABSENT         | space-scoping holds through search  |
 *  | 8 | договор     | inherited child PRESENT (for Bea)   | inherited-grant disjunct composes   |
 *
 * Rows 4–5 are the Phase-2 fuzzy/ranking proof: `'превет'` is NOT a prefix of any title,
 * so ONLY the trigram `word_similarity` tier can surface 'Привет команде' (a pure Phase-1
 * prefix search would miss it); and the `onboarding` pair proves the banded scorer puts a
 * TITLE match strictly above a DESCRIPTION match for the same term.
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  seedSearchCorpusFixture,
  teardownKnowledgeGraphTenant,
  teardownSearchCorpusFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type SearchCorpusFixture,
} from './helpers/knowledge-graph-bootstrap.js';

/** Run a search AS `actor` over `spaceId` (the REAL route, RLS-fenced) and return the
 * set of result resource ids — the unit of presence/absence the matrix asserts on. */
async function searchIds(
  actor: KnowledgeActor,
  spaceId: string,
  term: string
): Promise<Set<string>> {
  const client = await seedClientFor(actor);
  try {
    const { items } = await client.search(spaceId, term);
    return new Set(items.map((item) => item.id));
  } finally {
    await client.dispose();
  }
}

/** Run a search AS `actor` and return the result ids in SERVER RANK ORDER (score desc,
 * then title) — the unit the ranking assertion (row 5) compares relative positions on. */
async function searchRankedIds(
  actor: KnowledgeActor,
  spaceId: string,
  term: string
): Promise<string[]> {
  const client = await seedClientFor(actor);
  try {
    const { items } = await client.search(spaceId, term);
    return items.map((item) => item.id);
  } finally {
    await client.dispose();
  }
}

test.describe('lexical search — match matrix (prefix + fuzzy/ranking) + RLS absence @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: SearchCorpusFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedSearchCorpusFixture(tenant);
  });

  test.afterAll(async () => {
    await teardownSearchCorpusFixture(fx);
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        [fx?.searcherB.userId].filter((id): id is string => Boolean(id))
      );
    }
  });

  test('(1) `договор` finds the Cyrillic node (Cyrillic + case-insensitive prefix)', async () => {
    const hits = await searchIds(fx.searcher, fx.spaceId, 'договор');
    expect(hits.has(fx.cyrillicId)).toBe(true);
  });

  test('(2) `egerie` finds the accented node (accent fold via unaccent)', async () => {
    const hits = await searchIds(fx.searcher, fx.spaceId, 'egerie');
    expect(hits.has(fx.accentId)).toBe(true);
  });

  test('(3) `GETTING` finds the English node (case-insensitive prefix)', async () => {
    const hits = await searchIds(fx.searcher, fx.spaceId, 'GETTING');
    expect(hits.has(fx.englishId)).toBe(true);
  });

  test('(4) `превет` finds the Cyrillic greeting via fuzzy word_similarity (typo tolerance)', async () => {
    // `превет` (typo: е for и) is NOT a prefix of any title, so a Phase-1 prefix/exact
    // search would MISS it — only the Phase-2 pg_trgm word_similarity tier (≈0.4 ≥ 0.3
    // threshold) can surface 'Привет команде'. Its PRESENCE is the fuzzy-tier proof.
    const hits = await searchIds(fx.searcher, fx.spaceId, 'превет');
    expect(hits.has(fx.typoTargetId)).toBe(true);
  });

  test('(5) a TITLE match outranks a DESCRIPTION match for the same term (banded scorer)', async () => {
    // Two corpus nodes BOTH match `onboarding`: one via its TITLE ('Onboarding Guide'),
    // one via its DESCRIPTION ('Workspace Setup'). The banded scorer puts the title band
    // strictly above the description band, so the server returns the title-match BEFORE the
    // description-match. Assert both are present AND the title-match precedes the other.
    const ranked = await searchRankedIds(fx.searcher, fx.spaceId, 'onboarding');
    const titlePos = ranked.indexOf(fx.onboardingTitleId);
    const descPos = ranked.indexOf(fx.onboardingDescriptionId);
    expect(titlePos).toBeGreaterThanOrEqual(0);
    expect(descPos).toBeGreaterThanOrEqual(0);
    expect(titlePos).toBeLessThan(descPos);
  });

  test('(6) a non-grantee does NOT see another user’s PRIVATE node (RLS is the fence)', async () => {
    // `admin` searches a term that prefix-matches Bea's private node. Bea (its owner) DOES
    // see it; `admin` (a non-grantee) must NOT — RLS fences the row, no app filter does.
    const adminHits = await searchIds(fx.searcher, fx.spaceId, 'договор');
    expect(adminHits.has(fx.privateOtherOwnerId)).toBe(false);

    const ownerHits = await searchIds(fx.searcherB, fx.spaceId, 'договор');
    expect(ownerHits.has(fx.privateOtherOwnerId)).toBe(true);
  });

  test('(7) a search does NOT cross into another space (space-scoping holds)', async () => {
    // Space B holds a node whose title shares the `договор` prefix. The space-A searcher
    // searches space A; the per-space scope + RLS keep the foreign node out entirely.
    const hits = await searchIds(fx.searcher, fx.spaceId, 'договор');
    expect(hits.has(fx.otherSpace.nodeId)).toBe(false);

    // Sanity: that node IS findable in its OWN space by its own owner — proving its
    // absence above is the space fence, not the node failing to match the term.
    const ownSpaceHits = await searchIds(
      fx.otherSpace.tenant.granted,
      fx.otherSpace.tenant.spaceId,
      'договор'
    );
    expect(ownSpaceHits.has(fx.otherSpace.nodeId)).toBe(true);
  });

  test('(8) an ancestor-shared child is PRESENT for the grantee (inherited-grant disjunct)', async () => {
    // The child was NEVER granted to Bea directly; only its ANCESTOR folder was. The
    // inherited-grant disjunct (ADR-0023) the reused RLS predicate composes makes the
    // child readable — and that composes through search verbatim, so it appears.
    const beaHits = await searchIds(fx.searcherB, fx.spaceId, 'договор');
    expect(beaHits.has(fx.inheritedChildId)).toBe(true);
  });
});
