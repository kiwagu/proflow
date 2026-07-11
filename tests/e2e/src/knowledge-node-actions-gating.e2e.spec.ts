/**
 * Capability-aware `⋯` node-actions menu — display-gating acceptance.
 *
 * The Drive `⋯` menu hides the items a viewer cannot actually perform, mirroring the
 * `knowledge_resources` write/delete RLS predicate EXACTLY:
 *   canModify(node) = owner OR space.knowledge.update   → Edit / Rename / Move / New-subfolder
 *   canDelete(node) = owner OR space.knowledge.delete   → Delete (trash)
 *   New-subfolder also needs space.knowledge.create.
 * Copy (duplicates into the viewer's OWN space) and Details (a read) ALWAYS stay.
 *
 * This is fail-SAFE UX, NEVER the security boundary — RLS remains the sole authority;
 * hiding only spares a shared, non-owner viewer a silent no-op route hit. The test
 * renders the REAL page over the seeded graph for two actors:
 *   - `member` (read + create only, NOT the owner of the shared node): sees Copy +
 *     Details, and NONE of Edit / Rename / Move / New-subfolder / Delete.
 *   - `granted` (owner + all knowledge verbs): sees the FULL set.
 *
 * The viewer's space verbs are resolved server-side (`resolveSpaceCapabilities` →
 * `auth_user_can_access_in_space`, the same predicate the policy uses) and combined
 * with per-node ownership in the menu — so this proves the server signal AND its
 * render in one pass. Tagged `@full` — needs the running stack (author app + Postgres).
 */
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  bootstrapMemberActor,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

// The proxy's active-space cookie (mirror of @workspace/gateway-auth's
// ACTIVE_SPACE_COOKIE) — inlined here to keep the e2e package free of a new workspace
// dependency, exactly as BASE is inlined. A drift would fail this test loudly.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

/** An API context carrying the actor's SSR auth cookie — used for the graph writes. */
async function apiFor(actor: KnowledgeActor): Promise<APIRequestContext> {
  const cookies = await actorSsrAuthCookies(actor);
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return request.newContext({
    baseURL: BASE,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { cookie },
  });
}

/**
 * A browser context already authenticated AS the actor, with the active space pinned
 * to `spaceId` — so `page.goto('/author/graph')` renders the Drive for that actor +
 * space directly (no UI login / space-picker dance). The cookies are the byte-exact
 * `@supabase/ssr` set the author proxy reads back, plus the proxy's active-space cookie.
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

/** Create a text doc AS the actor; returns its node id. */
async function createTextDoc(
  api: APIRequestContext,
  spaceId: string,
  title: string
): Promise<string> {
  const res = await api.post('/author/graph/text-resources', {
    data: { spaceId, title },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { node_id: string }).node_id;
}

/** Open the `⋯` menu for the single shared node on the root canvas. */
async function openNodeMenu(page: Page): Promise<void> {
  await page.goto('/author/graph', { timeout: 60_000 });
  // The shared doc is the only node on the member's root canvas — wait for it.
  await expect(page.getByText('Shared Lesson').first()).toBeVisible({
    timeout: 60_000,
  });
  // The card `⋯` trigger is opacity-gated (hover-reveal) but fully actionable. Use an
  // EXACT name match: the clickable card button's accessible name CONTAINS "More" (the
  // overlaid trigger's label folds in), so a substring match would click the card
  // (→ opens Details) instead of the menu trigger. `exact` pins the trigger itself.
  // The Details panel's `⋯` (the complementary aside) shares the name, so scope to the
  // canvas region first, then take the single card trigger.
  await page.getByRole('button', { name: 'More', exact: true }).first().click();
}

test.describe('@full knowledge node-actions display gating', () => {
  let tenant: KnowledgeGraphTenant;
  let sharedDocId: string;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    const grantedApi = await apiFor(tenant.granted);
    // `granted` owns the doc and publishes it to the space floor so a non-owning
    // member can SEE it (the precondition for the "shared with me, not owned" case).
    sharedDocId = await createTextDoc(
      grantedApi,
      tenant.spaceId,
      'Shared Lesson'
    );
    const pub = await grantedApi.patch('/author/graph/visibility', {
      data: { resourceId: sharedDocId, visibility: 'space' },
    });
    expect(pub.status()).toBe(200);
    await grantedApi.dispose();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('a shared, non-owner viewer WITHOUT verbs sees only Copy + Details', async ({
    browser,
  }) => {
    // `member`: read + create only, NOT the owner of the shared doc → canModify and
    // canDelete are both false; Copy (duplicates into their own space) + Details stay.
    const member = await bootstrapMemberActor(tenant);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, member, tenant.spaceId);
      await openNodeMenu(page);

      const menu = page.getByRole('menu');
      // Stays: the always-available read/own-space actions.
      await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Details' })
      ).toBeVisible();
      // Hidden: every write/delete-class item (the routes would no-op under RLS).
      await expect(menu.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: 'Rename' })).toHaveCount(
        0
      );
      await expect(
        menu.getByRole('menuitem', { name: 'Move to…' })
      ).toHaveCount(0);
      await expect(
        menu.getByRole('menuitem', { name: 'New subfolder' })
      ).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(
        0
      );
    } finally {
      await context.close();
    }
  });

  test('the owner (verb-holder) sees the full action set', async ({
    browser,
  }) => {
    // `granted`: owns the doc AND holds every knowledge verb → the full menu.
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await openNodeMenu(page);

      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem', { name: 'Copy' })).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Details' })
      ).toBeVisible();
      // A text node → Edit + Rename + Move + Delete (New-subfolder is folder-only,
      // so it stays hidden on a `text` node regardless of verbs — the kind gate).
      await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Rename' })
      ).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Move to…' })
      ).toBeVisible();
      await expect(
        menu.getByRole('menuitem', { name: 'Delete' })
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
