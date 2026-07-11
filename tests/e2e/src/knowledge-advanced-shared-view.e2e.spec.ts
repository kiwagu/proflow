/**
 * Tariff-gated advanced (structural) view of the STRUCTURAL lenses — Addendum
 * A acceptance.
 *
 * The structural lenses (the two Shared lenses + Starred) ship FLAT (a digest). Addendum
 * A adds an ADVANCED display mode that renders the SAME RLS-visible lens
 * node-set as the KB containment TREE, gated by ONE generic COMMERCIAL
 * `advanced_structural_view` entitlement (a scoped `runtime_settings` row, resolved
 * global→org→space with org∧space AND-composition by Wave 1's `rpc_resolve_platform_flag`).
 * It is VIEW-ONLY: the advanced view shows EXACTLY the flat view's nodes — only the layout
 * differs — so the gate is an entitlement, never a security boundary (RLS is untouched;
 * the same node-set renders in both modes).
 *
 * Coverage:
 *  - SHARED (the original Fork 5 cases): entitled toggles Flat↔Advanced (same set, as a
 *    tree; orphan-at-root); folder-drill stays on the lens; the Advanced choice persists
 *    via the `lens-view` cookie (Pro-only); locked = disabled+hint and `?view=advanced`/
 *    stale-cookie still flat; org-off forces space-off.
 *  - STARRED (Addendum A3): the SAME structural toggle renders the starred set as a tree;
 *    folder-drill stays on Starred.
 *  - NEGATIVE (the decided exclusions): the toggle NEVER renders on Recent or Home.
 *
 * NOTE — TRASH (Addendum A4) is NOT covered here: its structural tree needs the `contains`
 * edges among trashed nodes, which are DORMANT (the edge SELECT RLS hides both-trashed
 * edges), so it cannot be built from a thin user-RLS select — surfaced for a decision.
 *
 * The fixture is built through the product's own `/author/graph/*` routes under each
 * actor's RLS (the shared seed create-vocabulary) — never a migration seed. The
 * entitlement rows are a control-plane config write via service-role (setup only).
 *
 * Tagged `@full` — needs the running stack (Next author app + Postgres).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  actorSsrAuthCookies,
  ADVANCED_SHARED_TITLES,
  bootstrapKnowledgeGraphTenant,
  bootstrapMemberActor,
  seedAdvancedSharedFixture,
  seedClientFor,
  setAdvancedStructuralEntitlement,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

// The proxy's active-space cookie (mirror of @workspace/gateway-auth's
// ACTIVE_SPACE_COOKIE) — inlined to keep the e2e package free of a new workspace dep,
// exactly as BASE is inlined. A drift would fail this test loudly.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// The shared-fixture titles — the SAME set must appear in both display modes. Sourced
// from the shared catalog scenario (`ADVANCED_SHARED_SCENARIO`) so the demo DB and this
// spec name the same nodes; the fixture's tree is materialized through the one
// `/author/graph/*` create-vocabulary (no inline createFolder/createDoc here).
const SHARED_FOLDER = ADVANCED_SHARED_TITLES.folder;
const NESTED_DOC = ADVANCED_SHARED_TITLES.nested; // inside SHARED_FOLDER → nests in advanced
const ROOT_DOC = ADVANCED_SHARED_TITLES.orphan; // parent folder NOT shared → root of the tree

/**
 * A browser context authenticated AS the actor with the active space pinned — so
 * `page.goto('/author/graph?...')` renders the Drive for that actor + space directly.
 */
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

/** Navigate to the "Shared with me" lens (optionally requesting a display mode). */
async function gotoSharedLens(page: Page, view?: 'advanced'): Promise<void> {
  const qs = view ? `?scope=shared&view=${view}` : '?scope=shared';
  await page.goto(`/author/graph${qs}`, { timeout: 60_000 });
  // The three shared nodes are the member's whole shared lens — wait for one.
  await expect(page.getByText(ROOT_DOC).first()).toBeVisible({
    timeout: 60_000,
  });
}

/** The list-layout toggle makes tree subRows render inline (the chevron is the tree
 * signal). Switch to list so the structural assertion is DOM-observable. */
async function switchToListLayout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'List view' }).click();
}

test.describe('@full advanced shared view (tariff-gated, view-only)', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let member: KnowledgeActor;
  let fxFolderId: string;
  let fxNestedDocId: string;
  let fxOrphanDocId: string;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();

    // Build the shared fixture from the SHARED CATALOG (`ADVANCED_SHARED_SCENARIO`) via
    // `materializeFixture` — owned by the tenant's `granted` (`admin`) actor, created
    // through the one `/author/graph/*` create-vocabulary (folders/docs + `contain` +
    // `setFloor` floor publishes). The worked-example tree the fixture materializes:
    //   SHARED_FOLDER (published) ⊃ NESTED_DOC (published)   → nests in the advanced tree
    //   Private Parent (NOT published) ⊃ ROOT_DOC (published) → ROOT_DOC's parent is not
    //                                                            shared → it sits at root
    // The private parent stays private → it is invisible to the member, so ROOT_DOC's
    // containing folder is NOT in the shared set → ROOT_DOC roots in the advanced tree
    // (no synthetic ancestor). The named refs/titles are resolved on the returned fixture.
    const fx = await seedAdvancedSharedFixture(tenant);
    fxFolderId = fx.folderId;
    fxNestedDocId = fx.nestedDocId;
    fxOrphanDocId = fx.orphanDocId;

    // A plain member (read+create, NOT the owner) — its "shared with me" lens is exactly
    // the three published nodes the fixture publishes to the space floor.
    member = await bootstrapMemberActor(tenant);
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(
      tenant,
      [member?.userId].filter((id): id is string => Boolean(id))
    );
  });

  test('ENTITLED: toggle flips flat↔advanced; advanced set == flat set as a tree; orphan at root', async ({
    browser,
  }) => {
    // Entitle the space: BOTH org and space rows true (AND-composition).
    await setAdvancedStructuralEntitlement(tenant, { org: true, space: true });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      await gotoSharedLens(page);
      // Use list layout throughout: subRows render inline, so the flat-vs-tree
      // distinction is DOM-observable (the folder's expand chevron is the tree signal).
      await switchToListLayout(page);

      // FLAT (default): all three shared nodes show as a flat digest — the baseline
      // SET. It is FLAT: NO row carries a tree expand control (the chevron's a11y label
      // is "Expand folder"). The shared folder is just a sibling row of the docs.
      await expect(page.getByText(SHARED_FOLDER).first()).toBeVisible();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible();
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(0);

      // The toggle is present + ENABLED on the entitled plan.
      const flatBtn = page.getByRole('button', { name: 'Flat', exact: true });
      const advBtn = page.getByRole('button', {
        name: 'Advanced',
        exact: true,
      });
      await expect(flatBtn).toBeEnabled();
      await expect(advBtn).toBeEnabled();

      // Switch to ADVANCED → the structural tree over the SAME shared set. The shared
      // FOLDER now gains an expand control (it has a nested shared child); the nested
      // doc is COLLAPSED away (it is no longer a flat sibling — it nests under its
      // parent), while the orphan ROOT_DOC stays at the top level.
      await advBtn.click();
      await expect(page.getByText(SHARED_FOLDER).first()).toBeVisible();
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible();
      const expandFolder = page.getByRole('button', {
        name: 'Expand folder',
        exact: true,
      });
      await expect(expandFolder).toHaveCount(1);
      // Nested-under-parent (not a flat sibling): hidden until the folder is expanded.
      await expect(page.getByText(NESTED_DOC)).toHaveCount(0);

      // Expand → the nested doc is revealed as a CHILD (the containment tree). It was a
      // flat sibling before; now it nests under its shared parent — same node, tree shape.
      await expandFolder.click();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible();

      // The orphan (parent-not-shared) doc sits at the ROOT — proven by it being present
      // while only the ONE folder carries an expand control (no synthetic ancestor folder
      // was fabricated for it). The tree now shows exactly the flat set: folder + nested
      // child + orphan-at-root.
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(0); // the sole folder is now "Collapse folder"
      await expect(
        page.getByRole('button', { name: 'Collapse folder', exact: true })
      ).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test('ENTITLED: drilling a folder in the advanced tree STAYS on the Shared lens; the crumb returns to root', async ({
    browser,
  }) => {
    // (amended Fork 4 / TASK 1): the advanced Shared tree is folder-NAVIGABLE
    // within its lens — drilling a folder narrows to its subtree WITHIN the shared set
    // and keeps the Shared scope (never breaks out to kb-browse).
    await setAdvancedStructuralEntitlement(tenant, { org: true, space: true });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      // Open the lens directly in advanced mode (entitled).
      await gotoSharedLens(page, 'advanced');
      await switchToListLayout(page);

      // Drill INTO the shared folder (double-click the folder row opens it). The nested
      // shared doc becomes a top-level row of the drilled subtree; the scope STAYS Shared.
      await page.getByText(SHARED_FOLDER).first().dblclick();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible({
        timeout: 30_000,
      });
      // The URL kept the Shared lens + advanced mode (did NOT reset to kb-browse).
      await expect
        .poll(() => new URL(page.url()).searchParams.get('scope'))
        .toBe('shared');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('view'))
        .toBe('advanced');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('folder'))
        .not.toBeNull();
      // The orphan doc (a ROOT sibling of the folder, NOT inside it) is gone from the
      // drilled subtree — the drill narrowed WITHIN the shared set.
      await expect(page.getByText(ROOT_DOC)).toHaveCount(0);

      // The lens-label crumb ("Shared with me") returns to the lens root, still Shared.
      // Two controls share the name — the SIDEBAR nav item and the breadcrumb crumb; the
      // crumb is the LAST one (the toolbar renders after the sidebar). Click the crumb.
      await page
        .getByRole('button', { name: 'Shared with me', exact: true })
        .last()
        .click();
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(() => new URL(page.url()).searchParams.get('scope'))
        .toBe('shared');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('folder'))
        .toBeNull();
    } finally {
      await context.close();
    }
  });

  test('ENTITLED: from the advanced Shared tree, the Knowledge base lens still activates (regression)', async ({
    browser,
  }) => {
    // Regression for the folder-drill change: the KB sidebar lens used
    // `navigate(null)`, which the advanced-Shared drill now keeps ON the Shared lens — so
    // clicking "Knowledge base" while in the advanced Shared tree trapped the user there.
    // The lens switch must leave Shared for kb-root regardless of the display mode.
    await setAdvancedStructuralEntitlement(tenant, { org: true, space: true });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      await gotoSharedLens(page, 'advanced');
      // The Shared-only display toggle is present while on the Shared lens.
      await expect(
        page.getByRole('button', { name: 'Advanced', exact: true })
      ).toBeVisible({ timeout: 30_000 });

      // Click the "Knowledge base" sidebar lens — must switch scope away from Shared.
      await page
        .getByRole('button', { name: 'Knowledge base', exact: true })
        .click();

      // Left the Shared lens: scope param cleared (kb is the default, omitted), and the
      // Shared-only Flat/Advanced toggle is gone (it renders only for the Shared lenses).
      await expect
        .poll(() => new URL(page.url()).searchParams.get('scope'))
        .toBeNull();
      await expect
        .poll(() => new URL(page.url()).searchParams.get('folder'))
        .toBeNull();
      await expect(
        page.getByRole('button', { name: 'Advanced', exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('ENTITLED: the Advanced choice PERSISTS across a reload via the server-read cookie (Pro only)', async ({
    browser,
  }) => {
    // (amended Fork 4 / TASK 2): the Flat/Advanced choice is remembered across
    // sessions via a server-read `shared-view` cookie (mirroring the grid/list layout
    // cookie), written ONLY on the entitled (Pro) plan. A reload with NO `?view=` in the
    // URL still renders advanced because the cookie carries the preference.
    await setAdvancedStructuralEntitlement(tenant, { org: true, space: true });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      // Land FLAT (no ?view=), switch to ADVANCED via the toggle → writes the cookie.
      await gotoSharedLens(page);
      await switchToListLayout(page);
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(1);

      // Reload at a CLEAN lens URL (no `?view=`) — the cookie alone must restore advanced.
      await page.goto('/author/graph?scope=shared', { timeout: 60_000 });
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible({
        timeout: 60_000,
      });
      await switchToListLayout(page);
      await expect(
        page.getByRole('button', { name: 'Advanced', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test('LOCKED: the Advanced choice cannot persist — a reload stays flat (cookie ignored/clamped)', async ({
    browser,
  }) => {
    // TASK 2 gate: a locked plan never persists 'advanced'. Even a hand-planted cookie is
    // clamped server-side to 'flat' (the entitlement is the authority, not the cookie).
    await setAdvancedStructuralEntitlement(tenant, {
      org: false,
      space: false,
    });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      // Plant a stale 'advanced' cookie directly — the locked plan must IGNORE it.
      const url = new URL(BASE);
      await context.addCookies([
        {
          name: 'shared-view',
          value: 'advanced',
          domain: url.hostname,
          path: '/',
        },
      ]);
      const page = await pageFor(context, member, tenant.spaceId);
      await gotoSharedLens(page);
      await switchToListLayout(page);

      // The server clamped the stale cookie to flat: the toggle reads Flat-pressed and
      // there is no tree (no expand control), proving the cookie can't unlock advanced.
      await expect(
        page.getByRole('button', { name: 'Flat', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('LOCKED: toggle is disabled with the upsell hint; ?view=advanced still renders flat; same set', async ({
    browser,
  }) => {
    // Lock the space: both rows false (the cheapest plan).
    await setAdvancedStructuralEntitlement(tenant, {
      org: false,
      space: false,
    });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      // Even with a HAND-EDITED `?view=advanced`, a locked plan renders flat — the
      // server clamps the effective mode to 'flat'.
      const page = await pageFor(context, member, tenant.spaceId);
      await gotoSharedLens(page, 'advanced');

      // The toggle is shown but DISABLED (the locked control IS the upsell, never hidden).
      const advBtn = page.getByRole('button', {
        name: 'Advanced',
        exact: true,
      });
      await expect(advBtn).toBeVisible();
      await expect(advBtn).toBeDisabled();

      // The upsell hint is reachable (the disabled control is wrapped in `Hint`).
      // Retry the WHOLE hover→tooltip cycle (the suite's toPass pattern): a single
      // hover with a swallowed failure left the assert waiting for a tooltip that
      // was never triggered — the Radix tooltip only opens on a FRESH pointerenter,
      // so each retry first parks the mouse away, then re-hovers.
      await expect(async () => {
        await page.mouse.move(0, 0);
        await advBtn.hover({ timeout: 2_000 });
        await expect(page.getByText(/available on/i).first()).toBeVisible({
          timeout: 2_000,
        });
      }).toPass({ timeout: 30_000 });

      // The SAME node-set is shown either way (view-only — no data difference). And it
      // is FLAT: all three shared nodes are flat siblings — NO tree expand control, even
      // though the URL requested `?view=advanced` (the server clamped it to flat).
      await expect(page.getByText(SHARED_FOLDER).first()).toBeVisible();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible();
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible();

      await switchToListLayout(page);
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('org-off forces space-off (AND-composition): an entitled space row alone does not unlock', async ({
    browser,
  }) => {
    // The space row is true but the ORG row is false — the resolver AND-composes them,
    // so the effective entitlement is false (a space's plan can never exceed its org's).
    await setAdvancedStructuralEntitlement(tenant, { org: false, space: true });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      await gotoSharedLens(page, 'advanced');

      // Locked: the toggle is disabled and the view stays flat despite ?view=advanced.
      const advBtn = page.getByRole('button', {
        name: 'Advanced',
        exact: true,
      });
      await expect(advBtn).toBeDisabled();

      // FLAT despite the entitled SPACE row — the org-off forces the AND to false, so
      // the shared set renders flat (no tree expand control on the folder).
      await switchToListLayout(page);
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(0);
      // The same node-set is still shown (view-only — the gate withholds layout, not data).
      await expect(page.getByText(SHARED_FOLDER).first()).toBeVisible();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible();
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  // ── STARRED advanced (the generalization to a second lens) ───────────────────

  test('STARRED: entitled → the same structural toggle renders the starred set as a tree; folder-drill stays on Starred', async ({
    browser,
  }) => {
    // The structural view is now LENS-AGNOSTIC: Starred gets the SAME Flat/Advanced
    // toggle as Shared, over its own node-set (the member's starred ids ∩ canvas), built
    // by the SAME `buildContainment` over the LIVE forest (starred items are live).
    await setAdvancedStructuralEntitlement(tenant, { org: true, space: true });

    // The MEMBER stars (per-user state) the shared folder + its nested doc + the orphan
    // doc — all visible to it. Starred set = {folder, nested, orphan}; the tree nests the
    // nested doc under the folder, and the orphan (its parent is NOT starred) roots.
    const memberApi = await seedClientFor(member);
    await memberApi.star(tenant.spaceId, fxFolderId, true);
    await memberApi.star(tenant.spaceId, fxNestedDocId, true);
    await memberApi.star(tenant.spaceId, fxOrphanDocId, true);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      await page.goto('/author/graph?scope=starred', { timeout: 60_000 });
      await expect(page.getByText(SHARED_FOLDER).first()).toBeVisible({
        timeout: 60_000,
      });
      await switchToListLayout(page);

      // FLAT Starred: the three starred nodes are flat siblings — no tree control.
      await expect(
        page.getByRole('button', { name: 'Expand folder', exact: true })
      ).toHaveCount(0);

      // Toggle ADVANCED (the SAME toolbar control, now on Starred) → the starred set as a
      // tree: the folder gains an expand control; the nested doc collapses under it.
      await page.getByRole('button', { name: 'Advanced', exact: true }).click();
      await expect(page.getByText(SHARED_FOLDER).first()).toBeVisible();
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible(); // orphan at root
      const expandFolder = page.getByRole('button', {
        name: 'Expand folder',
        exact: true,
      });
      await expect(expandFolder).toHaveCount(1);
      await expect(page.getByText(NESTED_DOC)).toHaveCount(0); // nested, not a flat sibling
      await expandFolder.click();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible();

      // Folder-drill STAYS on the Starred lens (the stay-in-lens logic is lens-agnostic).
      await page.getByText(SHARED_FOLDER).first().dblclick();
      await expect(page.getByText(NESTED_DOC).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(() => new URL(page.url()).searchParams.get('scope'))
        .toBe('starred');
      await expect
        .poll(() => new URL(page.url()).searchParams.get('view'))
        .toBe('advanced');
      // The orphan is a sibling of the folder, not inside it → gone from the drilled subtree.
      await expect(page.getByText(ROOT_DOC)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // ── the DECIDED exclusions (Recent / Home are NOT structural) ─────────────────

  test('NEGATIVE: the Flat/Advanced toggle NEVER renders on Recent or Home (structurally excluded)', async ({
    browser,
  }) => {
    // Recent is a log/ordering and Home a personal digest — neither is a containment
    // projection, so the structural toggle must NOT appear there even on the entitled plan.
    await setAdvancedStructuralEntitlement(tenant, { org: true, space: true });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);

      // RECENT — open a node first so the lens is non-empty, then assert no toggle.
      await (await seedClientFor(member)).open(tenant.spaceId, fxOrphanDocId);
      await page.goto('/author/graph?scope=recent', { timeout: 60_000 });
      await expect(page.getByText(ROOT_DOC).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(
        page.getByRole('button', { name: 'Flat', exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Advanced', exact: true })
      ).toHaveCount(0);

      // HOME — likewise excluded.
      await page.goto('/author/graph?scope=home', { timeout: 60_000 });
      await expect(
        page.getByRole('button', { name: 'Advanced', exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
