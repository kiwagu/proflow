/**
 * Resource status lifecycle — the workbench transition control + the Drive status facet
 * (B1). `knowledge_resources.status` is a coarse three-state column (`draft` → `active`
 * → `archived`, migration 20260615190243). Making it writable through a thin RLS route
 * (`PATCH /author/graph/status`, gated by `space.knowledge.update`) let the workbench add
 * two purely-presentational surfaces over the SAME resolved canvas:
 *
 *  1. the ResourcePanel transition control (`StatusSection`) — a SegmentedControl of the
 *     three states, the active one = the node's current `status`; clicking a non-active
 *     segment PATCHes the status route, then the workbench re-resolves. Rendered for
 *     CONTENT kinds only.
 *  2. the Drive status facet (`StatusFacetChips`, `graph.lens.filterStatus`) — a single-
 *     select chip row (All / Draft / Active / Archived) that prunes the canvas to CONTENT
 *     in one lifecycle state, the exact sibling of the "Only files" toggle. Shown only when
 *     the resolved canvas carries ≥2 DISTINCT content statuses.
 *
 * The tree comes ENTIRELY from the shared `STATUS_LIFECYCLE_SCENARIO` catalog (the `drive`
 * + `status` presets, via `seedStatusLifecycleFixture`) — a folder of three text docs, one
 * per lifecycle state — so the demo DB and this test name the SAME nodes at the SAME states
 * through the ONE create-vocabulary. A create defaults `status='draft'`, so the two
 * non-draft docs are lifted to `active`/`archived` at seed time through the product's OWN
 * new route (the materializer's `lifecycleStatus` → `seedClientFor(owner).setStatus`),
 * exactly as the panel's control does — never a direct column write.
 *
 * Coverage:
 *  (1) TRANSITION under RLS — the owner opens the draft doc's panel (Draft segment
 *      pressed), clicks Active → the PATCH succeeds and the new state persists across a
 *      re-resolve AND a full reload (asserted via `aria-pressed`). Restores to draft so the
 *      fixture stays pristine for the facet/negative tests.
 *  (2) STATUS FACET — on a content lens with ≥2 statuses the `graph.lens.filterStatus` chip
 *      row is present; selecting "Draft" narrows the canvas to draft content (the active +
 *      archived docs drop); "All" restores.
 *  (3) RLS NEGATIVE — a space member WITHOUT `space.knowledge.update` (the tenant's
 *      `space_admin` actor) cannot change a foreign node's status: the PATCH is rejected
 *      (422) and the status is unchanged (owner re-read).
 *
 * The i18n labels are matched as a key-OR-label regex (`/^(Draft|graph\.status\.draft)$/`
 * etc.) so the spec is green whether or not the running catalog was rebuilt — the render is
 * key-driven and the behaviour is identical either way.
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  seedStatusLifecycleFixture,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type StatusLifecycleFixture,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';
// The proxy's active-space cookie (mirror of @workspace/gateway-auth's ACTIVE_SPACE_COOKIE)
// — inlined to keep the e2e package dep-free, exactly as the sibling render specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// Key-OR-label regexes: the segment / facet labels are driven by the graph catalog keys
// (graph.status.*, graph.lens.filterStatus, graph.drive.facetAll). Match BOTH the resolved
// label AND the raw key, so the spec is green whether or not the running app's catalog has
// been rebuilt to include them (the render is key-driven; the behaviour is identical).
const DRAFT = /^(Draft|graph\.status\.draft)$/;
const ACTIVE = /^(Active|graph\.status\.active)$/;
const ALL = /^(All|graph\.drive\.facetAll)$/;
const FILTER_STATUS = /Filter by status|graph\.lens\.filterStatus/;
// The facet filters now live behind ONE toolbar "Filters" dropdown (a `filterChip` Button
// with `aria-pressed`; an active-facet count may append to its name → startsWith match, no
// `$` anchor). Match BOTH the resolved label AND the raw key, catalog-rebuild-agnostic.
const FILTERS = /^(Filters|graph\.lens\.filters)/;

/** A browser context authenticated AS the actor with the active space pinned. Mirrors the
 * sibling render specs' `pageFor`. */
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

/** The grid card whose name cell holds the exact title (the `div.group` card wrapper) —
 * the SAME locator the sibling media/size render specs use. */
function card(page: Page, title: string) {
  return page
    .locator('div.group', { has: page.getByText(title, { exact: true }) })
    .first();
}

/** Open the fixture folder and single-click the doc → its ResourcePanel ("Details"). The
 * panel is an `<aside aria-label={title}>` = the `complementary` landmark named by title. */
async function openPanel(page: Page, title: string) {
  await expect(card(page, title)).toBeVisible({ timeout: 60_000 });
  await card(page, title).getByText(title, { exact: true }).click();
  return page.getByRole('complementary', { name: title });
}

/** Open the toolbar "Filters" dropdown and return its Popover content. The facet chips
 * (tag / status / shared-mechanism) moved out of the content body into this ONE Popover, so
 * they only exist in the DOM while it is open — a facet test must open this FIRST, then
 * click the chip INSIDE the returned content. The open is retried against a hydration race
 * (the trigger paints from SSR before it is interactive). */
async function openFilters(page: Page) {
  const trigger = page.getByRole('button', { name: FILTERS });
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  const content = page.locator('[data-slot="popover-content"]');
  await expect(async () => {
    await trigger.click();
    await expect(content).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return content;
}

test.describe('@full B1 — resource status lifecycle (transition control + status facet)', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: StatusLifecycleFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedStatusLifecycleFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
  });

  // ── (1) transition under RLS ────────────────────────────────────────────────

  test('(1) the owner transitions a draft doc to Active via the panel control; the new state persists across re-resolve and reload', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });

      // Open the DRAFT doc's Details panel — the Status section shows Draft as the active
      // segment (its create-time default), Active not pressed.
      const panel = await openPanel(page, fx.titles.draft);
      const draftSeg = panel.getByRole('button', { name: DRAFT });
      const activeSeg = panel.getByRole('button', { name: ACTIVE });
      await expect(draftSeg).toHaveAttribute('aria-pressed', 'true', {
        timeout: 30_000,
      });
      await expect(activeSeg).toHaveAttribute('aria-pressed', 'false');

      // Click Active → PATCH /author/graph/status → the workbench re-resolves, and the
      // panel's segment flips (the status the server returned).
      await activeSeg.click();
      await expect(activeSeg).toHaveAttribute('aria-pressed', 'true', {
        timeout: 30_000,
      });
      await expect(draftSeg).toHaveAttribute('aria-pressed', 'false');

      // Persistence across a FULL reload — reopen the panel; the node is still Active
      // (the status is materialized in `knowledge_resources.status`, not view state).
      await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });
      const panel2 = await openPanel(page, fx.titles.draft);
      await expect(
        panel2.getByRole('button', { name: ACTIVE })
      ).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

      // Restore to draft so the facet / negative tests see the pristine fixture state.
      await panel2.getByRole('button', { name: DRAFT }).click();
      await expect(panel2.getByRole('button', { name: DRAFT })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 30_000 }
      );
    } finally {
      await context.close();
    }
  });

  // ── (2) the status facet (client-side content prune) ────────────────────────

  test('(2) the status facet chip row narrows the canvas to one lifecycle state; "All" restores', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });

      // All three lifecycle docs are visible.
      await expect(card(page, fx.titles.draft)).toBeVisible({
        timeout: 60_000,
      });
      await expect(card(page, fx.titles.active)).toBeVisible();
      await expect(card(page, fx.titles.archived)).toBeVisible();

      // Open the toolbar "Filters" dropdown — the ≥2-distinct-statuses guard renders the
      // status facet COLUMN inside it (its leading `graph.lens.filterStatus` label). The
      // chips live only in this Popover now, so open it before touching them.
      const filters = await openFilters(page);
      await expect(filters.getByText(FILTER_STATUS).first()).toBeVisible({
        timeout: 30_000,
      });

      // Select "Draft" → the canvas narrows to draft content: the draft doc stays, the
      // active + archived docs drop (a client-side prune over `LensNode.status`).
      const draftChip = filters.getByRole('button', { name: DRAFT });
      await draftChip.click();
      await expect(draftChip).toHaveAttribute('aria-pressed', 'true', {
        timeout: 30_000,
      });
      await expect(card(page, fx.titles.draft)).toBeVisible();
      await expect(card(page, fx.titles.active)).toHaveCount(0);
      await expect(card(page, fx.titles.archived)).toHaveCount(0);

      // "All" restores every state.
      const allChip = filters.getByRole('button', { name: ALL });
      await allChip.click();
      await expect(allChip).toHaveAttribute('aria-pressed', 'true', {
        timeout: 30_000,
      });
      await expect(card(page, fx.titles.active)).toBeVisible();
      await expect(card(page, fx.titles.archived)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // ── (3) RLS negative — no space.knowledge.update ────────────────────────────

  test('(3) a member without space.knowledge.update cannot change a foreign node status (422, unchanged)', async () => {
    // The archived doc is owned by `owner` and private; `stranger` (space_admin, no
    // knowledge verbs) drives the REAL status route with its OWN session cookies — RLS is
    // the SOLE authority, so the UPDATE matches no row and the route fails closed (422).
    const strangerClient = await seedClientFor(fx.stranger);
    try {
      const res = await strangerClient.patch('/author/graph/status', {
        spaceId: fx.spaceId,
        resourceId: fx.archivedDocId,
        status: 'draft',
      });
      expect(res.status).toBe(422);
    } finally {
      await strangerClient.dispose();
    }

    // The status is UNCHANGED — read back under the OWNER's RLS (a setup/assertion read).
    const { data, error } = await fx.owner.client
      .from('knowledge_resources')
      .select('status')
      .eq('id', fx.archivedDocId)
      .single();
    expect(error, error?.message).toBeNull();
    expect(data?.status).toBe('archived');
  });
});
