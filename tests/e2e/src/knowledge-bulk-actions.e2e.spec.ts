/**
 * Drive multi-select + bulk action bar + Empty Trash (release-hardening B2) — the runtime
 * net for the destructive bulk flow. Multi-select is a UI capability over the resolved
 * canvas; every bulk verb is a client FAN-OUT over the EXISTING per-id `/author/graph/*`
 * routes (trash = resource DELETE, restore = trash PATCH, star = starred POST), and
 * Delete-forever / Empty Trash go through the ALREADY-BUILT batch purge endpoint
 * (`DELETE /author/graph/trash {resourceIds[]}`) whose response is the honest partial split.
 * A green build proves NONE of this — only a live run proves the checkboxes drive the bar,
 * the bar drives the routes under RLS, and the batch route never widens nor crashes.
 *
 * The tree comes ENTIRELY from the shared `BULK_ACTIONS_SCENARIO` catalog (the `drive`
 * capability group, via `seedBulkActionsFixture`) — a folder of four selectable content
 * siblings (titles sort in declaration order → a deterministic SHIFT-range) beside two
 * loose docs soft-deleted at seed time (a known Trash lens) — so the demo DB and this test
 * name the SAME nodes through the one create-vocabulary, never an inline tree.
 *
 * Coverage (the runtime behaviours a green build can't prove):
 *  (1) checkbox ≠ Details + SHIFT-range — a per-card checkbox click toggles selection and
 *      does NOT open the Details drawer (the `complementary` landmark stays absent); a
 *      SHIFT-click selects the contiguous run between the anchor and the clicked card over
 *      the ordered-visible list.
 *  (2) multi-select → bulk Trash — select ≥2 content siblings via their checkboxes, the
 *      floating bulk bar appears; Delete trashes both (they leave the canvas + land in the
 *      Trash lens) and the honest done-summary shows.
 *  (3) bulk Restore — in the Trash lens, select the seeded trashed pair → Restore → they
 *      leave Trash and round-trip back to the KB root.
 *  (4) bulk Star — select the surviving content siblings → Star → they appear in the
 *      Starred lens.
 *  (5) Empty Trash — the Trash toolbar Empty-Trash button opens a MANDATORY confirm
 *      (cancel leaves the trashed nodes); confirming batch-purges ALL → the Trash renders
 *      empty.
 *  (6) RLS-negative / honest partial summary — the batch route with a mix of an own-trashed
 *      id + a second actor's node the caller cannot destroy (+ a bogus id) returns 200 with
 *      the own id in `purged` and the foreign/bogus ids in `skipped` (reason `denied`); the
 *      action never widens and never crashes, and the foreign node survives.
 *
 * The bulk-bar / Empty-Trash labels are matched as a key-OR-label regex (the render is
 * catalog-key-driven) so the spec is green whether or not the running catalog was rebuilt;
 * the range/selection proofs key on the checkboxes' `aria-checked` (catalog-independent).
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  bootstrapMemberActor,
  seedBulkActionsFixture,
  seedClientFor,
  teardownKnowledgeGraphTenant,
  type BulkActionsFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';
// The proxy's active-space cookie (mirror of @workspace/gateway-auth's ACTIVE_SPACE_COOKIE)
// — inlined to keep the e2e package dep-free, exactly as the sibling render specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// Key-OR-label regexes for the catalog-driven bulk-bar / Empty-Trash controls. Match BOTH
// the resolved English label AND the raw key, so the spec is green whether or not the
// running app's catalog was rebuilt (the render is key-driven; the behaviour is identical).
const DELETE = /^(Delete|graph\.panel\.delete)$/;
const STAR = /^(Add star|graph\.drive\.star)$/;
const RESTORE = /^(Restore|graph\.trash\.restore)$/;
const EMPTY_TRASH = /^(Empty Trash|graph\.trash\.emptyTrash)$/;
const CANCEL = /^(Cancel|graph\.panel\.cancel)$/;
const SELECT_ALL = /^(Select all|graph\.bulk\.selectAll)$/;
const DONE_SUMMARY = /done|graph\.bulk\.summary/;
const TRASH_EMPTY = /Trash is empty|graph\.trash\.empty/;

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
 * the SAME locator the sibling status/media/size render specs use. */
function card(page: Page, title: string) {
  return page
    .locator('div.group', { has: page.getByText(title, { exact: true }) })
    .first();
}

/** The per-card multi-select checkbox (one per card; `aria-checked` is the selection). */
function cardCheckbox(page: Page, title: string) {
  return card(page, title).getByRole('checkbox');
}

/** The floating bulk action bar (the `bg-popover` chip) — scoped so its verb buttons
 * (Restore / Add star / Delete) never collide by accessible name with the identically-
 * named per-card buttons (the card star's `aria-label`, the TrashCard's Restore). */
function bulkBar(page: Page) {
  return page
    .locator('div.bg-popover')
    .filter({ hasText: /selected|Working|done|graph\.bulk/ });
}

test.describe('@full B2 — Drive multi-select + bulk action bar + Empty Trash', () => {
  test.describe.configure({ timeout: 240_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: BulkActionsFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedBulkActionsFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
  });

  // ── (1) checkbox ≠ Details + SHIFT-range ────────────────────────────────────

  test('(1) a checkbox click selects WITHOUT opening Details; SHIFT-click selects a contiguous range', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });

      // All four siblings are on the canvas.
      await expect(card(page, fx.titles.alpha)).toBeVisible({
        timeout: 60_000,
      });
      await expect(card(page, fx.titles.bravo)).toBeVisible();
      await expect(card(page, fx.titles.charlie)).toBeVisible();
      await expect(card(page, fx.titles.delta)).toBeVisible();

      // Plainly toggle Alpha (the anchor). The checkbox stops propagation, so the Details
      // drawer (the `complementary` landmark named by the title) must NOT open.
      await cardCheckbox(page, fx.titles.alpha).click();
      await expect(cardCheckbox(page, fx.titles.alpha)).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: 30_000 }
      );
      await expect(
        page.getByRole('complementary', { name: fx.titles.alpha })
      ).toHaveCount(0);

      // SHIFT-click Charlie → the contiguous run Alpha…Charlie over the ordered-visible
      // list (Alpha, Bravo, Charlie, Delta): Alpha + Bravo + Charlie select, Delta stays.
      await cardCheckbox(page, fx.titles.charlie).click({
        modifiers: ['Shift'],
      });
      await expect(cardCheckbox(page, fx.titles.bravo)).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: 30_000 }
      );
      await expect(cardCheckbox(page, fx.titles.charlie)).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(cardCheckbox(page, fx.titles.delta)).toHaveAttribute(
        'aria-checked',
        'false'
      );
      // Exactly three cards selected (the range) — the select-all header goes
      // indeterminate, so only the three card checkboxes read checked.
      await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(
        3
      );
      // …and Details never opened for any card the range touched.
      await expect(
        page.getByRole('complementary', { name: fx.titles.charlie })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // ── (2) bulk Restore (Trash lens → the seeded trashed pair) ─────────────────

  test('(2) bulk Restore returns the seeded trashed pair from the Trash lens to the KB root', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto('/author/graph?scope=trash', { timeout: 60_000 });

      // The Trash lens opens with the two seed-trashed docs.
      await expect(
        page.getByText(fx.titles.trashedOne, { exact: true })
      ).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByText(fx.titles.trashedTwo, { exact: true })
      ).toBeVisible();

      // Select ALL visible (the two trashed) via the tri-state header, then Restore.
      await page.getByRole('checkbox', { name: SELECT_ALL }).click();
      await expect(
        page.getByRole('checkbox', { checked: true })
      ).not.toHaveCount(0, { timeout: 30_000 });
      await bulkBar(page).getByRole('button', { name: RESTORE }).click();

      // Both leave the Trash lens (restored).
      await expect(
        page.getByText(fx.titles.trashedOne, { exact: true })
      ).toHaveCount(0, { timeout: 60_000 });
      await expect(
        page.getByText(fx.titles.trashedTwo, { exact: true })
      ).toHaveCount(0);

      // …and round-trip back to the KB root (they were loose docs — no rebuild).
      await page.goto('/author/graph', { timeout: 60_000 });
      await expect(
        page.getByText(fx.titles.trashedOne, { exact: true })
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        page.getByText(fx.titles.trashedTwo, { exact: true })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // ── (3) multi-select → bulk Trash ───────────────────────────────────────────

  test('(3) selecting two content siblings via their checkboxes and Trash lands both in the Trash lens', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });

      // Select Alpha + Bravo via their per-card checkboxes → the floating bulk bar appears.
      await expect(card(page, fx.titles.alpha)).toBeVisible({
        timeout: 60_000,
      });
      await cardCheckbox(page, fx.titles.alpha).click();
      await cardCheckbox(page, fx.titles.bravo).click();
      await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(
        2,
        {
          timeout: 30_000,
        }
      );

      // The bulk bar's content-lens Trash verb (Delete). Trash fans out over the per-id
      // resource DELETE — no confirm (only purge confirms).
      await bulkBar(page).getByRole('button', { name: DELETE }).click();

      // Both leave the folder canvas, and the honest done-summary lands.
      await expect(card(page, fx.titles.alpha)).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(card(page, fx.titles.bravo)).toHaveCount(0);
      await expect(page.getByText(DONE_SUMMARY).first()).toBeVisible({
        timeout: 30_000,
      });

      // …and both land in the Trash lens.
      await page.goto('/author/graph?scope=trash', { timeout: 60_000 });
      await expect(
        page.getByText(fx.titles.alpha, { exact: true })
      ).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByText(fx.titles.bravo, { exact: true })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // ── (4) bulk Star ───────────────────────────────────────────────────────────

  test('(4) bulk Star pins the surviving content siblings into the Starred lens', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });

      // Charlie + Delta survive (Alpha/Bravo were trashed in test 3). Select all visible.
      await expect(card(page, fx.titles.charlie)).toBeVisible({
        timeout: 60_000,
      });
      await page.getByRole('checkbox', { name: SELECT_ALL }).click();
      await expect(
        page.getByRole('checkbox', { checked: true })
      ).not.toHaveCount(0, { timeout: 30_000 });

      // Star fans out over the per-id starred POST.
      await bulkBar(page).getByRole('button', { name: STAR }).click();
      await expect(page.getByText(DONE_SUMMARY).first()).toBeVisible({
        timeout: 30_000,
      });

      // Both appear in the Starred lens.
      await page.goto('/author/graph?scope=starred', { timeout: 60_000 });
      await expect(
        page.getByText(fx.titles.charlie, { exact: true })
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        page.getByText(fx.titles.delta, { exact: true })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // ── (5) Empty Trash — mandatory confirm ─────────────────────────────────────

  test('(5) Empty Trash is a MANDATORY confirm — cancel keeps the trashed nodes; confirm empties the lens', async ({
    browser,
  }) => {
    // Guarantee ≥2 trashed nodes independent of prior tests — create + trash two fresh
    // docs through the shared create-vocabulary (owner's RLS), so the Empty Trash proof
    // never depends on another test's residue.
    const api = await seedClientFor(fx.owner);
    const keepA = 'Empty Trash Guard A';
    const keepB = 'Empty Trash Guard B';
    const a = await api.createDoc(fx.spaceId, keepA);
    const b = await api.createDoc(fx.spaceId, keepB);
    await api.trash(fx.spaceId, a.nodeId);
    await api.trash(fx.spaceId, b.nodeId);
    await api.dispose();

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, fx.spaceId);
      await page.goto('/author/graph?scope=trash', { timeout: 60_000 });

      await expect(page.getByText(keepA, { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText(keepB, { exact: true })).toBeVisible();

      // Open the Empty Trash confirm and CANCEL → nothing is destroyed (mandatory gate).
      await page.getByRole('button', { name: EMPTY_TRASH }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await dialog.getByRole('button', { name: CANCEL }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText(keepA, { exact: true })).toBeVisible();
      await expect(page.getByText(keepB, { exact: true })).toBeVisible();

      // Re-open and CONFIRM → the batch purge empties the Trash lens.
      await page.getByRole('button', { name: EMPTY_TRASH }).click();
      const dialog2 = page.getByRole('dialog');
      await expect(dialog2).toBeVisible({ timeout: 30_000 });
      await dialog2.getByRole('button', { name: EMPTY_TRASH }).click();

      await expect(page.getByText(keepA, { exact: true })).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(page.getByText(keepB, { exact: true })).toHaveCount(0);
      // The empty state renders (nothing left to purge).
      await expect(page.getByText(TRASH_EMPTY).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await context.close();
    }
  });

  // ── (6) RLS-negative / honest partial summary (the batch route) ─────────────

  test('(6) batch purge is honest under RLS — own id purged, a foreign + a bogus id skipped (denied), 200, nothing widened', async () => {
    // A second actor owns a PRIVATE trashed node the owner cannot SEE — so the owner's
    // batch purge of it must be an honest no-op (`denied`), never a silent destroy. This
    // mirrors how the single-purge honest-no-op is proved, but over the BATCH route.
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await seedClientFor(member);
    const ownerApi = await seedClientFor(fx.owner);
    const sid = fx.spaceId;

    // The owner's own trashed node (the caller CAN destroy it).
    const own = await ownerApi.createDoc(sid, 'Batch Own Target');
    await ownerApi.trash(sid, own.nodeId);

    // The member's PRIVATE trashed node (invisible to the owner → cannot destroy it).
    const foreign = await memberApi.createDoc(sid, 'Batch Foreign Target');
    await memberApi.trash(sid, foreign.nodeId);

    const bogus = 'knr_this_id_does_not_exist';

    // One batch call over the mix — each id is fenced INDEPENDENTLY under the caller's RLS.
    const result = await ownerApi.purgeMany(sid, [
      own.nodeId,
      foreign.nodeId,
      bogus,
    ]);

    // The own id is really destroyed; the foreign + bogus ids are skipped as `denied`
    // (the DELETE hit 0 rows with no error) — never a throw, never a widened delete.
    expect(result.purged).toContain(own.nodeId);
    expect(result.purged).not.toContain(foreign.nodeId);
    const skippedIds = new Map(
      result.skipped.map((s) => [s.resourceId, s.reason])
    );
    expect(skippedIds.get(foreign.nodeId)).toBe('denied');
    expect(skippedIds.get(bogus)).toBe('denied');

    // The foreign node SURVIVES (nothing widened) and stays trashed.
    const { data: foreignStill } = await tenant.service
      .from('knowledge_resources')
      .select('id,deleted_at')
      .eq('id', foreign.nodeId);
    expect(foreignStill ?? []).toHaveLength(1);
    expect(
      (foreignStill ?? [])[0] as { deleted_at: string | null }
    ).not.toBeNull();

    // The owner's node is GONE (the one-way door reached exactly what the caller could see).
    const { data: ownGone } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('id', own.nodeId);
    expect(ownGone ?? []).toHaveLength(0);

    await memberApi.dispose();
    await ownerApi.dispose();
  });
});
