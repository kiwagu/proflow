/**
 * Lexical search — Phase-1 match matrix + the RLS-absence proof (ADR-0024, slice-12;
 * the merge gate). Search is a SUBSTRATE capability, a SIBLING of projection-resolve:
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
 * Phase-1 rows ONLY (the Phase-2 fuzzy `'превет'`→`'Привет команде'` typo + the ranking
 * row need the Phase-2 trigram tier, which is not in the compiler yet — the typo NODE is
 * seeded now so the corpus is complete, but its assertion waits):
 *
 *  | # | Query     | Expected                          | Verifies                              |
 *  |---|-----------|-----------------------------------|---------------------------------------|
 *  | 1 | договор   | 'Договор аренды' PRESENT          | Cyrillic + case-insensitive prefix    |
 *  | 2 | egerie    | 'Égérie' PRESENT                  | accent fold (unaccent)                |
 *  | 3 | GETTING   | 'Getting Started' PRESENT         | case-insensitive prefix               |
 *  | 6 | договор   | Bea's PRIVATE node ABSENT (admin) | RLS is the fence, not an app filter   |
 *  | 7 | договор   | another SPACE's node ABSENT       | space-scoping holds through search    |
 *  | 8 | договор   | inherited child PRESENT (for Bea) | inherited-grant disjunct composes     |
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

test.describe('lexical search — Phase-1 match matrix + RLS absence @full', () => {
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
