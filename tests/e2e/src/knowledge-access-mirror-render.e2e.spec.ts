/**
 * The access-mirror invariant on the RENDER — (Tier 1 + Tier 2),
 * extended to the access-STATUS taxonomy (globe = broadcast, people = targeted, none =
 * private).
 *
 * Wave 1 proved the DATA predicate (`knowledge-containment-inheritance.e2e.spec.ts`):
 * a node is readable if it OR a granted ANCESTOR folder is granted (owner-scoped, live).
 * Wave 2 renders that SAME predicate as two read-only surfaces over the OWNER's own
 * client view, and this spec proves they MIRROR it (`badge ≡ panel-summary
 * ≡ access predicate`, never divergent), now as the three mutually-exclusive states:
 *
 *   - GLOBE (broadcast) — flagged ONLY for an ORGANIZATION-wide broadcast (wider than the
 *     space). SPACE-FIRST refinement: a SPACE-wide broadcast is the TYPICAL
 *     KB audience, so it shows NO badge — a clean card reads as "shared with the space";
 *     the panel still names the "Space" floor. Broadcast outranks people.
 *   - PEOPLE (targeted) — the node is in the owner's outbound grant set (per-user OR
 *     cohort, direct OR via a granted ancestor), AND not broadcast.
 *   - NONE (private) — neither broadcast nor granted: a personal node, flagged with a LOCK.
 *
 * The cases, over the SHARED `CONTAINMENT_INHERITANCE_SCENARIO` catalog (via
 * `seedContainmentInheritanceFixture` — no inline tree):
 *   (A) per-user DIRECT (`Shared Folder`, granted to grantee)     → people + panel grantees.
 *   (B) per-user INHERITED (`Own Child Doc`, inside Shared Folder) → people + panel
 *       "Inherited from Shared Folder" (no direct grantee line).
 *   (C) PRIVATE, un-shared (`Private Unshared Doc`)               → NEITHER badge nor a
 *       shared/inherited summary (the panel says "private only").
 *   (D) BROADCAST DIRECT (`Floor Folder`, visibility=space)       → NO badge (space-first
 *       blank) + panel "Space" floor.
 *   (E) BROADCAST INHERITED (`Floor Own Child Doc`, under it)      → NO badge + panel
 *       "Broadcast to Space via Floor Folder".
 *   (F) COHORT (`Cohort Folder`, scope→Cohort A)                  → people + panel cohort
 *       grantee, counted/labelled as a COHORT ("Shared with 1 cohort", not "person") —
 *       the extended `sharedByMe` cohort-by-me path.
 *
 * Rendered AS THE OWNER (`admin` = the grantor): the badge + panel Access summary are the
 * owner's mirror of the grants THEY authored (`kbData.sharedByMe`, SSR-seeded under the
 * owner's own RLS — no service-role). Display-only — RLS untouched.
 *
 * Tagged `@full` — needs the running stack (Next author app + Postgres).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedContainmentInheritanceFixture,
  teardownKnowledgeGraphTenant,
  type ContainmentInheritanceFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

// The proxy's active-space cookie (mirror of @workspace/gateway-auth's ACTIVE_SPACE_COOKIE)
// — inlined to keep the e2e package dep-free, exactly as the sibling specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// The seeded titles (from CONTAINMENT_INHERITANCE_SCENARIO) — the demo DB and this spec
// name the SAME nodes through the one create-vocabulary.
const SHARED_FOLDER = 'Shared Folder';
const OWN_CHILD = 'Own Child Doc';
const PRIVATE_UNSHARED = 'Private Unshared Doc';
const FLOOR_FOLDER = 'Floor Folder';
const FLOOR_OWN_CHILD = 'Floor Own Child Doc';
const COHORT_FOLDER = 'Cohort Folder';
const COHORT_A = 'Cohort A';

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

/** The CARD (grid tile) for a node, scoped to the main content so it never matches the
 * sidebar "Sections" folder list (which navigates on a single click). Cards are the
 * `.group` wrappers; sidebar rows are not. */
function card(page: Page, title: string) {
  return page
    .locator('div.group', { has: page.getByText(title, { exact: true }) })
    .first();
}

/** Open the Drive at the KB root and wait for the owner's tree to render. */
async function gotoDriveRoot(page: Page): Promise<void> {
  await page.goto('/author/graph', { timeout: 60_000 });
  await expect(card(page, SHARED_FOLDER)).toBeVisible({ timeout: 60_000 });
}

/** Single-click a CARD → open the shared Details panel (the access-mirror Tier 2). The
 * click targets the card tile in the content area, not the sidebar (which navigates). */
async function openDetailsPanel(page: Page, title: string): Promise<Page> {
  await card(page, title).getByText(title, { exact: true }).click();
  // The panel is an <aside aria-label="{title}"> — wait for it + the Access section.
  const panel = page.getByRole('complementary', { name: title });
  await expect(panel.getByText('Access', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  return page;
}

test.describe('@full access-mirror on the render (badge ≡ panel ≡ access)', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: ContainmentInheritanceFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedContainmentInheritanceFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        [
          fx?.grantee.userId,
          fx?.ownerB.userId,
          fx?.adminC.userId,
          fx?.cohortMember.userId,
          fx?.cohortStranger.userId,
        ].filter((id): id is string => Boolean(id))
      );
    }
  });

  test('(A) a DIRECTLY-shared resource shows the badge AND the panel grantee summary', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, tenant.spaceId);
      await gotoDriveRoot(page);

      // Tier 1 — the "Shared" people-icon badge is on the shared folder card. Its Hint
      // aria-label names the grantee ("Shared with Folder Grantee"), so the badge can
      // never imply sharing without saying with whom.
      await expect(
        page.getByLabel(/Shared with Folder Grantee/i).first()
      ).toBeVisible({ timeout: 30_000 });

      // Tier 2 — open the Details panel; the read-only Access section names the grantees.
      await openDetailsPanel(page, SHARED_FOLDER);
      const panel = page.getByRole('complementary', { name: SHARED_FOLDER });
      // "Shared with 1 person" header + the grantee's name in the bounded scroll list.
      await expect(panel.getByText(/Shared with 1 person/i)).toBeVisible();
      await expect(panel.getByText('Folder Grantee')).toBeVisible();
      // It is NOT presented as merely inherited — this folder carries its OWN grant.
      await expect(panel.getByText(/Inherited from/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('(B) a resource shared only via a granted ANCESTOR shows the badge AND the panel "Inherited from {folder}" line', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, tenant.spaceId);
      // Drill into the shared folder so the own-child is visible in the tree.
      await gotoDriveRoot(page);
      await card(page, SHARED_FOLDER)
        .getByText(SHARED_FOLDER, { exact: true })
        .dblclick();
      await expect(card(page, OWN_CHILD)).toBeVisible({
        timeout: 30_000,
      });

      // Tier 1 — the own-child carries the badge purely via its granted ANCESTOR. The
      // Hint names the inheriting folder ("Shared via Shared Folder"), never a grantee.
      await expect(
        page.getByLabel(/Shared via Shared Folder/i).first()
      ).toBeVisible({ timeout: 30_000 });

      // Tier 2 — the panel expresses the SAME chain as a named "Inherited from" line.
      await openDetailsPanel(page, OWN_CHILD);
      const panel = page.getByRole('complementary', { name: OWN_CHILD });
      await expect(
        panel.getByText(`Inherited from ${SHARED_FOLDER}`)
      ).toBeVisible();
      // No DIRECT grantee summary — its access is purely inherited (the badge mirrors this).
      await expect(
        panel.getByText(/Shared with \d+ (person|people)/i)
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('(C) a PRIVATE un-shared resource shows NEITHER the badge NOR a shared/inherited summary', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, tenant.spaceId);
      await gotoDriveRoot(page);
      await expect(card(page, PRIVATE_UNSHARED)).toBeVisible({
        timeout: 30_000,
      });

      // Tier 1 — the private card must carry NO "Shared"/"Shared via"/"Shared with" badge
      // (the access-mirror negative, scoped to this node's card).
      await expect(
        card(page, PRIVATE_UNSHARED).getByLabel(/^Shared/i)
      ).toHaveCount(0);

      // Tier 2 — open its Details panel and assert the Access section.
      await openDetailsPanel(page, PRIVATE_UNSHARED);
      const panel = page.getByRole('complementary', { name: PRIVATE_UNSHARED });

      // Tier 2 — the Access section shows the private floor + the plain "private only"
      // line, and NEITHER a grantee summary NOR an "Inherited from" line.
      await expect(panel.getByText('Private', { exact: true })).toBeVisible();
      await expect(
        panel.getByText(/Only you and supervisors can see this/i)
      ).toBeVisible();
      await expect(
        panel.getByText(/Shared with \d+ (person|people)/i)
      ).toHaveCount(0);
      await expect(panel.getByText(/Inherited from/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('(D) a space-FLOOR resource shows NO badge (space-first blank) AND the panel Space floor', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, tenant.spaceId);
      await gotoDriveRoot(page);
      await expect(card(page, FLOOR_FOLDER)).toBeVisible({ timeout: 30_000 });

      // Tier 1 — SPACE-FIRST: a space-wide broadcast is the typical KB
      // audience, so a clean card IS the signal — neither a GLOBE (that's reserved for the
      // wider organization-wide broadcast) NOR a people "Shared with" badge.
      await expect(
        card(page, FLOOR_FOLDER).getByLabel(/Visible to everyone/i)
      ).toHaveCount(0);
      await expect(
        card(page, FLOOR_FOLDER).getByLabel(/Shared with/i)
      ).toHaveCount(0);

      // Tier 2 — the panel Access floor still reads "Space" (the at-a-glance broadcast
      // state): the badge is blank, but the panel names the floor — badge ≡ panel.
      await openDetailsPanel(page, FLOOR_FOLDER);
      const panel = page.getByRole('complementary', { name: FLOOR_FOLDER });
      await expect(panel.getByText('Space', { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(E) a child under a space-floor folder shows NO badge AND the panel "Broadcast … via {folder}" line (floor inheritance)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, tenant.spaceId);
      await gotoDriveRoot(page);
      // Drill into the floor folder so the own-child is visible in the tree.
      await card(page, FLOOR_FOLDER)
        .getByText(FLOOR_FOLDER, { exact: true })
        .dblclick();
      await expect(card(page, FLOOR_OWN_CHILD)).toBeVisible({
        timeout: 30_000,
      });

      // Tier 1 — the child is broadcast purely via its space-floor ANCESTOR, which under
      // SPACE-FIRST is the typical audience → a clean card, NO globe (the
      // inherited space broadcast is blank, exactly like its parent folder).
      await expect(
        card(page, FLOOR_OWN_CHILD).getByLabel(/Visible to everyone/i)
      ).toHaveCount(0);

      // Tier 2 — the panel still expresses the SAME chain as a "Broadcast to Space via
      // {folder}" line (parallel to the per-user "Inherited from" line): badge ≡ panel.
      await openDetailsPanel(page, FLOOR_OWN_CHILD);
      const panel = page.getByRole('complementary', { name: FLOOR_OWN_CHILD });
      await expect(
        panel.getByText(`Broadcast to Space via ${FLOOR_FOLDER}`)
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('(F) a COHORT-shared resource shows the PEOPLE badge AND the panel cohort grantee (cohort-by-me)', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, fx.owner, tenant.spaceId);
      await gotoDriveRoot(page);
      await expect(card(page, COHORT_FOLDER)).toBeVisible({ timeout: 30_000 });

      // Tier 1 — a cohort grant I created (`linked_by = me`) now lights the PEOPLE badge,
      // closing the earlier per-user-only gap. It is NOT a globe (the cohort folder's floor
      // is private — only the cohort sees it, not the whole space).
      await expect(
        card(page, COHORT_FOLDER).getByLabel(/^Shared/i)
      ).toHaveCount(1);
      await expect(
        card(page, COHORT_FOLDER).getByLabel(/Visible to everyone/i)
      ).toHaveCount(0);

      // Tier 2 — the cohort appears in the bounded grantee list by its scope name (the
      // extended `sharedByMe` cohort-by-me path), labelling the audience as the group. The
      // summary header counts/labels it as a COHORT — "Shared with 1 cohort", NOT "person"
      // (cohorts are a distinct audience kind, the cohort-vs-people fix). The
      // EXACT-text match on the cohort name targets the grantee list item (the cohort name
      // standalone), not the description blurb that merely mentions it.
      await openDetailsPanel(page, COHORT_FOLDER);
      const panel = page.getByRole('complementary', { name: COHORT_FOLDER });
      await expect(panel.getByText(/Shared with 1 cohort/i)).toBeVisible();
      await expect(panel.getByText(COHORT_A, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
