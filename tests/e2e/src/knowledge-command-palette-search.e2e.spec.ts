/**
 * Command palette — the SECOND consumer of the lexical-search capability, on the RENDER
 * (ADR-0024 §5, slice-12 Phase 3 — the cross-client extensibility proof). The capability
 * is FROZEN for this phase: no engine / contract / route change. The palette reuses the
 * EXACT path the Drive search lens uses — the shared `useLexicalSearch` hook → the same
 * `POST /author/graph/search` route → `resolveSearchQuery` under the same REUSED RLS
 * transport (ADR-0009) → the same `SearchResult` shape. Postgres RLS is the SOLE access
 * fence (ADR-0024 §6); the palette only changes how the IDENTICAL rows are PRESENTED
 * (a ⌘K command box vs the Drive grid lens).
 *
 * This spec drives the palette through the BROWSER (the testids the render half exposes:
 * `command-palette-trigger` / `command-palette` / `command-palette-input` /
 * `command-palette-results` / `command-palette-result` / `command-palette-empty`) and
 * asserts the Phase-3 merge gate (slice-12 §2 Phase 3 / §3): the palette returns
 * RLS-fenced results IDENTICAL to the Drive lens for the same term.
 *
 * Its corpus comes from the SHARED `KNOWLEDGE_BASE_SCENARIO` catalog entry via
 * `seedSearchCorpusFixture` — the SAME shared fixture the Drive-lens search spec
 * (`knowledge-search.e2e.spec.ts`) draws from. There is NO inline `createDoc`/`createFolder`
 * tree here: both consumers build the multi-locale match set + the RLS-absence proof the
 * SAME way, through the one `/author/graph/*` create-vocabulary, so the demo seed and BOTH
 * tests speak one dictionary and name the same nodes by their stable `ref`s.
 *
 * Assertions (the palette mirror of the API-level match/RLS matrix the lens spec asserts):
 *
 *  | # | Query    | Expected in the palette                          | Verifies                          |
 *  |---|----------|--------------------------------------------------|-----------------------------------|
 *  | 1 | договор  | 'Договор аренды' PRESENT                          | Cyrillic + case-insensitive prefix|
 *  | 2 | egerie   | 'Égérie' PRESENT                                  | accent fold (unaccent)            |
 *  | 3 | GETTING  | 'Getting Started' PRESENT                         | case-insensitive prefix           |
 *  | 6 | договор  | another user's PRIVATE node ABSENT (for `admin`)  | RLS is the fence, not an app filter|
 *  | 7 | договор  | another SPACE's node ABSENT                       | space-scoping holds through search|
 *
 * Rows 6–7 are the security half of the Phase-3 gate (slice-12 §3 assertions 6–7): the
 * SECOND consumer fences identically — a non-grantee's PRIVATE node and a node in ANOTHER
 * space never surface in the palette, because RLS never returns them (no app-level filter).
 *
 * Tagged `@full` — needs the running stack (Next author app + Postgres).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedSearchCorpusFixture,
  teardownKnowledgeGraphTenant,
  teardownSearchCorpusFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type SearchCorpusFixture,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

// The proxy's active-space cookie (mirror of @workspace/gateway-auth's ACTIVE_SPACE_COOKIE)
// — inlined to keep the e2e package dep-free, exactly as the sibling render specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

/** A browser context authenticated AS the actor with the active space pinned. */
async function pageFor(
  context: BrowserContext,
  actor: KnowledgeActor,
  spaceId: string
): Promise<Page> {
  const ssr = await actorSsrAuthCookies(actor);
  const url = new URL(BASE);
  await context.addCookies([
    ...ssr.map((c) => ({
      name: c.name,
      value: c.value,
      domain: url.hostname,
      path: '/',
    })),
    {
      name: ACTIVE_SPACE_COOKIE,
      value: spaceId,
      domain: url.hostname,
      path: '/',
    },
  ]);
  return context.newPage();
}

/**
 * Open the Drive workbench, open the command palette via its TOP-BAR TRIGGER (a real
 * click, not a synthesised global ⌘K), type `term`, and wait for the results container
 * to settle (debounce + fetch). The palette is mounted in the workbench chrome — reachable
 * from the DEFAULT Drive view, never the `?scope=search` lens — which is itself the
 * extensibility proof: search is not Drive-lens-bound. Returns the palette dialog locator.
 */
async function openPaletteAndSearch(page: Page, term: string): Promise<void> {
  await page.goto('/author/graph', { timeout: 60_000 });

  const trigger = page.getByTestId('command-palette-trigger');
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  await trigger.click();

  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible({ timeout: 30_000 });

  const input = page.getByTestId('command-palette-input');
  await input.fill(term);

  // Let the shared debounced fetch resolve: the results container is always present once
  // the palette is open, but its rows land after the round-trip — wait for either a row or
  // the empty state to settle so an assertion never races the in-flight request.
  await expect(page.getByTestId('command-palette-results')).toBeVisible();
}

/** The set of result-row TITLE texts currently rendered in the palette (the unit the
 * presence/absence matrix asserts on — each row renders its node's title). */
async function paletteResultTitles(page: Page): Promise<string[]> {
  const rows = page.getByTestId('command-palette-result');
  return rows.allInnerTexts();
}

/** True when some palette result row's title text contains `title` (the row renders the
 * full title via the highlighter; an `includes` match tolerates the kind-label suffix). */
async function paletteHasTitle(page: Page, title: string): Promise<boolean> {
  const titles = await paletteResultTitles(page);
  return titles.some((text) => text.includes(title));
}

test.describe('@full command palette — lexical search (Phase-3 second consumer, RLS-identical to the Drive lens)', () => {
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

  test('(1) `договор` surfaces the Cyrillic node in the palette (Cyrillic + case-insensitive prefix)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.searcher, fx.spaceId);
      await openPaletteAndSearch(page, 'договор');
      await expect(async () => {
        expect(await paletteHasTitle(page, fx.cyrillicTitle)).toBe(true);
      }).toPass({ timeout: 20_000 });
    } finally {
      await context.close();
    }
  });

  test('(2) `egerie` surfaces the accented node in the palette (accent fold via unaccent)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.searcher, fx.spaceId);
      await openPaletteAndSearch(page, 'egerie');
      await expect(async () => {
        expect(await paletteHasTitle(page, fx.accentTitle)).toBe(true);
      }).toPass({ timeout: 20_000 });
    } finally {
      await context.close();
    }
  });

  test('(3) `GETTING` surfaces the English node in the palette (case-insensitive prefix)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.searcher, fx.spaceId);
      await openPaletteAndSearch(page, 'GETTING');
      await expect(async () => {
        expect(await paletteHasTitle(page, fx.englishTitle)).toBe(true);
      }).toPass({ timeout: 20_000 });
    } finally {
      await context.close();
    }
  });

  test('(6) the palette does NOT surface another user’s PRIVATE node (RLS is the fence, identical to the lens)', async ({
    browser,
  }) => {
    // `admin` searches a term that prefix-matches Bea's PRIVATE node. The Drive lens fences
    // it via RLS; the palette — the SAME route under the SAME transport — must fence it
    // identically. The Cyrillic node (`admin`'s own) IS present, proving the term matched and
    // the palette resolved; the private node's ABSENCE is therefore the RLS fence, not a
    // failed query.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.searcher, fx.spaceId);
      await openPaletteAndSearch(page, 'договор');

      // Anchor: `admin`'s own colliding-prefix node DID resolve in the palette.
      await expect(async () => {
        expect(await paletteHasTitle(page, fx.cyrillicTitle)).toBe(true);
      }).toPass({ timeout: 20_000 });

      // The non-grantee never sees the other owner's private node.
      expect(await paletteHasTitle(page, fx.privateOtherOwnerTitle)).toBe(
        false
      );
    } finally {
      await context.close();
    }
  });

  test('(7) the palette does NOT cross into another space (space-scoping holds through the second consumer)', async ({
    browser,
  }) => {
    // Space B holds a node whose title shares the `договор` prefix. The space-A searcher's
    // palette searches space A; the per-space scope + RLS keep the foreign node out — the
    // SAME absence the Drive lens proves, now through the second consumer.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.searcher, fx.spaceId);
      await openPaletteAndSearch(page, 'договор');

      await expect(async () => {
        expect(await paletteHasTitle(page, fx.cyrillicTitle)).toBe(true);
      }).toPass({ timeout: 20_000 });

      expect(await paletteHasTitle(page, fx.otherSpace.nodeTitle)).toBe(false);
    } finally {
      await context.close();
    }
  });
});
