/**
 * Search-lens "Only files" filter — the cross-lens uploaded-artifacts chip on the SEARCH
 * shelf. The "Only files" chip now lives on EVERY lens shelf by
 * construction (the shared `LensToolbar`), so the SAME `ToggleChip` the Drive lenses
 * carry appears on Search — and it FUNCTIONALLY filters the search RESULT set (a flat leaf
 * list) with the SAME `isUploadedArtifact` predicate: ON keeps only uploaded artifacts.
 *
 * The tree comes ENTIRELY from the shared `DRIVE_SIZE_FILTER_SCENARIO` catalog (via
 * `seedDriveSizeFilterFixture`) — the SAME fixture the Drive size/filter render spec draws
 * from — so the demo vocabulary and this test build the SAME nodes through the ONE
 * create-vocabulary, never an inline `createDoc`/upload tree. That fixture carries two loose
 * leaves sharing ONE distinctive title token (`Falcon`) so a single search returns BOTH — a
 * REAL uploaded file (`size/search-file`, an artifact, uploaded through the product's own
 * media transport so it has a real `media` satellite) and a plain text node
 * (`size/search-doc`, a non-artifact). A search for `Falcon` returns exactly these two; the
 * chip then keeps the file and drops the note.
 *
 * The proof is purely in the browser over the live search route: the browser POSTs the term
 * to `/author/graph/search` (RLS-fenced as the owner), the results render as cards in the
 * `drive-search-results` region, and the chip narrows them client-side. No API-only stub —
 * the same runtime path the Drive size/filter spec exercises for the Drive lenses, now on
 * the Search lens.
 *
 * Tagged `@full` — needs the running Supabase + author stack + REAL Storage (the artifact is
 * uploaded through the real media transport at seed time, so the predicate has a real
 * satellite to key on).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedDriveSizeFilterFixture,
  teardownKnowledgeGraphTenant,
  type DriveSizeFilterFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';
// The proxy's active-space cookie (mirror of @workspace/gateway-auth's ACTIVE_SPACE_COOKIE)
// — inlined to keep the e2e package dep-free, exactly as the sibling render specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// The "Only files" chip label (graph.drive.filterUploaded = "Only files"). Match BOTH the
// resolved label AND the raw key, so the spec is green whether or not the running app's
// catalog has been rebuilt to include the key (the render + behaviour are key-driven either
// way) — the SAME tolerant matcher the Drive size/filter spec uses.
const ONLY_FILES = /^(Only files|graph\.drive\.filterUploaded)$/;

/** A browser context authenticated AS the actor with the active space pinned. Mirrors the
 * sibling render specs' `pageFor` (no layout cookie — the search lens defaults to the grid
 * card render, which is all this proof needs). */
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

/** The "Only files" toggle chip on the search shelf (an `aria-pressed` button). */
function onlyFilesChip(page: Page) {
  return page.getByRole('button', { name: ONLY_FILES });
}

/** A search-result element (card or list row) carrying the exact title, scoped to the
 * results region so a stray sidebar/toolbar match never trips it. */
function resultFor(page: Page, title: string) {
  return page
    .getByTestId('drive-search-results')
    .getByText(title, { exact: true });
}

test.describe('@full render — Search-lens "Only files" filter', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: DriveSizeFilterFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedDriveSizeFilterFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
  });

  test('the "Only files" chip is on the search shelf and FUNCTIONALLY filters the result set to uploaded artifacts', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);

      // Open the SEARCH lens (the `?scope=search` view — the same lens the Drive rail's
      // "Search" nav item reaches). Wait for the search input to hydrate.
      await page.goto('/author/graph?scope=search', { timeout: 60_000 });
      const input = page.getByTestId('drive-search-input');
      await expect(input).toBeVisible({ timeout: 60_000 });

      // The "Only files" chip is PRESENT on the search shelf (the shared `LensToolbar`'s
      // filter slot), OFF by default.
      const chip = onlyFilesChip(page);
      await expect(chip).toBeVisible();
      await expect(chip).toHaveAttribute('aria-pressed', 'false');

      // Type the shared token — the live search (POST /author/graph/search, RLS-fenced as
      // the owner) returns BOTH the artifact hit and the non-artifact hit (both titles
      // prefix-match `Falcon`).
      await input.fill(fx.searchTerm);
      await expect(resultFor(page, fx.titles.searchFile)).toBeVisible({
        timeout: 60_000,
      });
      await expect(resultFor(page, fx.titles.searchDoc)).toBeVisible();

      // Toggle "Only files" ON → the chip FUNCTIONALLY narrows the result set to uploaded
      // artifacts: the real file (`size/search-file`) STAYS, the plain text note
      // (`size/search-doc`, a non-artifact) DROPS OUT — the chip filters, not just renders.
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(resultFor(page, fx.titles.searchFile)).toBeVisible();
      await expect(resultFor(page, fx.titles.searchDoc)).toHaveCount(0);

      // Toggle OFF → the non-artifact hit returns (a pure display filter, not a fence).
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(resultFor(page, fx.titles.searchDoc)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
