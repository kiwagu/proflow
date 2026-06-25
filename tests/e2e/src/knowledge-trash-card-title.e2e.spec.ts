/**
 * Trash lens TrashCard — DOM-layout regression net (the gap the existing suite lacked).
 *
 * The committed trash coverage is API-level (`knowledge-trash.e2e.spec.ts`) and the int
 * tests are jsdom (no layout engine), so neither can catch a WIDTH-SQUEEZE: in the
 * default (grid) Drive layout the TrashCard is a fixed 264px card, and a one-row
 * `[icon][title flex-1][Restore][Delete forever]` collapsed the `flex-1` title to ~zero
 * width — the trashed doc's TITLE was invisible, so the user could not tell WHICH
 * document they were about to restore / purge. The fix STACKS the grid card (title row
 * on top, actions on their own row beneath); list layout stays a single row (it has the
 * width). This test renders the REAL Trash lens in the DEFAULT (grid) layout and asserts
 * the title is a VISIBLE browser box (`toBeVisible()`, not merely in the DOM) with both
 * lifecycle actions reachable.
 *
 * Tagged `@full` — needs the running stack (Next author app + Postgres + Payload/Mongo).
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
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

// The proxy's active-space cookie (mirror of @workspace/gateway-auth's
// ACTIVE_SPACE_COOKIE) — inlined to keep the e2e package free of a new workspace
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
 * A browser context already authenticated AS the actor, active space pinned, so
 * `page.goto('/author/graph?scope=trash')` renders the Trash lens directly. Same cookie
 * recipe as the node-actions-gating suite (SSR auth set + the proxy active-space cookie).
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

test.describe('@full knowledge trash card title visibility', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('a trashed doc title is VISIBLE in the default (grid) Trash layout, with both actions reachable', async ({
    browser,
  }) => {
    const api = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    // A distinctive, long-ish title so a width-squeeze would visibly clip it — and so
    // this query never collides with the seed/other suites' fixtures.
    const title = `Squeeze Regression Doc ${Date.now()}`;
    const docId = await createTextDoc(api, sid, title);

    // Trash it as the owner (DELETE = soft trash) — it now lives only in the Trash lens.
    const delRes = await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: docId },
    });
    expect(delRes.status()).toBe(200);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, sid);
      // Default layout is grid (`resolveDriveLayout` defaults to 'grid'); `?scope=trash`
      // opens the Trash lens server-side (initialScope), so NO layout override is set —
      // this is exactly the common case the bug shipped in.
      await page.goto('/author/graph?scope=trash', { timeout: 60_000 });

      // The TITLE must be a VISIBLE browser box — not merely present in the DOM. A
      // width-squeeze leaves the truncated title element zero-width, which `toBeVisible`
      // rejects; this is the assertion the jsdom int tests structurally cannot make.
      const titleEl = page.getByText(title, { exact: true });
      await expect(titleEl).toBeVisible({ timeout: 60_000 });
      const box = await titleEl.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.width ?? 0).toBeGreaterThan(0);

      // Both lifecycle verbs stay reachable in the stacked grid card.
      await expect(
        page.getByRole('button', { name: 'Restore' }).first()
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Delete forever' }).first()
      ).toBeVisible();
    } finally {
      await context.close();
    }

    await api.dispose();
  });
});
