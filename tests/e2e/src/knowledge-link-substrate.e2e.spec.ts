/**
 * KB link substrate — a `kind='link'` node made REAL by its external URL in the
 * `kb.resource_link` satellite (slice-10 §2.4, ADR-0013 satellite machinery).
 * Unlike media there is no byte plane: the URL is stored text, so the security
 * surface is (a) the http(s)-only allow-list (anti stored-XSS — the URL renders
 * as an <a href>) and (b) the satellite RLS mirroring the parent node (a
 * non-grantee never reads another user's private URL). RLS is the SOLE fence —
 * no app-level filter (poc-no-fallbacks).
 *
 *  Functional:
 *   1  set a URL on an OWNED link node → 200; `host` is derived SERVER-side
 *      (lowercase hostname); a second set UPSERTs the SAME row (url + host move,
 *      no second satellite).
 *   2  ResourcePanel Link section shows the URL and an "Open" anchor
 *      (target=_blank, rel noopener) — and the Drive card meta line shows the host.
 *
 *  Scheme fence (the stored-XSS gate):
 *   3  `javascript:` / `data:` / `ftp:` / relative refs → 400 at the boundary;
 *      no satellite row is written.
 *
 *  RLS / access:
 *   4  a non-grantee cannot WRITE the owner's satellite (422) and cannot READ the
 *      URL at all (direct PostgREST select under its own JWT → zero rows), while
 *      the owner reads it back — the satellite mirrors the parent's access.
 *   5  an unauthenticated write → 401/403 (session required).
 *
 *  Copy (slice parity with the fan-out):
 *   6  copying a link node clones the satellite — the copy carries its OWN
 *      `kb.resource_link` row with the same url/host.
 *
 * Driven over HTTP through the SHARED seed client (`setLink` = the REAL
 * `attribute:'link'` route under the acting user's RLS) — one create-vocabulary
 * for demo + tests. Tagged `@full` — needs the running Supabase + author stack.
 */
import {
  expect,
  request,
  test,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedClientFor,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';
// The proxy's active-space cookie (mirror of @workspace/gateway-auth's
// ACTIVE_SPACE_COOKIE) — inlined to keep the e2e package dep-free, exactly as the
// sibling render specs do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

const LINK_URL = 'https://Status.Acme.example/incidents/42';
const LINK_HOST = 'status.acme.example';

/** POST `attribute:'link'` AS the actor via the raw seed fetcher — returns the
 * transport status + body so the negatives can assert 400/422 (the typed
 * `setLink` throws on non-200, which the positives use). */
async function postLinkAttribute(
  actor: KnowledgeActor,
  body: unknown
): Promise<{ status: number; body: unknown }> {
  const client = await seedClientFor(actor);
  try {
    return await client.post('/author/graph/attributes', body);
  } finally {
    await client.dispose();
  }
}

/** The CARD (grid tile) for a node in the content area — scoped to `div.group` so
 * it never matches the sidebar folder list. Mirrors the sibling render specs. */
function card(page: Page, title: string) {
  return page
    .locator('div.group', { has: page.getByText(title, { exact: true }) })
    .first();
}

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

test.describe('@full slice-10 §2.4 KB link substrate — real URL, RLS-fenced', () => {
  test.describe.configure({ timeout: 240_000 });

  let tenant: KnowledgeGraphTenant;
  /** The owned link node every test reads — created once, URL set in test 1. */
  let linkNodeId: string;
  let linkTitle: string;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    linkTitle = `External Status Link ${Date.now()}`;
    const owner = await seedClientFor(tenant.granted);
    try {
      linkNodeId = await owner.createNode(tenant.spaceId, 'link', linkTitle);
    } finally {
      await owner.dispose();
    }
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('(1) set URL on an owned link node → host derived server-side; re-set UPSERTs the same row', async () => {
    const sid = tenant.spaceId;
    const first = await postLinkAttribute(tenant.granted, {
      attribute: 'link',
      spaceId: sid,
      nodeId: linkNodeId,
      url: 'https://interim.example/somewhere',
    });
    expect(first.status).toBe(200);

    // Re-set (the panel edit path) — the UPSERT re-points the SAME satellite row.
    const second = await postLinkAttribute(tenant.granted, {
      attribute: 'link',
      spaceId: sid,
      nodeId: linkNodeId,
      url: LINK_URL,
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      node_id: linkNodeId,
      url: LINK_URL,
      // host = lowercase hostname, derived on the server (never client-supplied).
      host: LINK_HOST,
    });

    // Exactly ONE satellite row for the node (UPSERT, not append) — read under the
    // OWNER's OWN RLS (also the control read for the negative in test 4).
    const { data, error } = await tenant.granted.client
      .schema('kb')
      .from('resource_link')
      .select('url,host')
      .eq('node_id', linkNodeId);
    expect(error).toBeNull();
    expect(data).toEqual([{ url: LINK_URL, host: LINK_HOST }]);
  });

  test('(2) the card meta shows the host; the panel Link section shows the URL + a safe Open anchor', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await page.goto('/author/graph', { timeout: 60_000 });

      // The card meta line renders the DERIVED host (the loader filled
      // `attributes.link`; the display seam was already wired for it).
      const tile = card(page, linkTitle);
      await expect(tile).toBeVisible({ timeout: 60_000 });
      await expect(tile.getByText(LINK_HOST)).toBeVisible();

      // Single-click → Details panel; the Link section shows the URL and Open.
      await tile.getByText(linkTitle, { exact: true }).click();
      const panel = page.getByRole('complementary', { name: linkTitle });
      await expect(panel.getByText(LINK_URL)).toBeVisible({ timeout: 30_000 });
      const open = panel.getByRole('link', { name: /Open/i });
      await expect(open).toBeVisible();
      await expect(open).toHaveAttribute('href', LINK_URL);
      await expect(open).toHaveAttribute('target', '_blank');
      await expect(open).toHaveAttribute('rel', /noopener/);
    } finally {
      await context.close();
    }
  });

  test('(3) non-http(s) schemes are rejected at the boundary (400) — the stored-XSS gate', async () => {
    const sid = tenant.spaceId;
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'ftp://files.example/a',
      '/relative/path',
      'not a url',
    ]) {
      const res = await postLinkAttribute(tenant.granted, {
        attribute: 'link',
        spaceId: sid,
        nodeId: linkNodeId,
        url,
      });
      expect(res.status, `scheme fence for ${JSON.stringify(url)}`).toBe(400);
    }
    // The stored row is untouched by the rejected writes.
    const { data } = await tenant.granted.client
      .schema('kb')
      .from('resource_link')
      .select('url')
      .eq('node_id', linkNodeId);
    expect(data).toEqual([{ url: LINK_URL }]);
  });

  test('(4) a non-grantee can neither WRITE nor READ the owner private link URL', async () => {
    const sid = tenant.spaceId;
    // WRITE: the satellite insert/update mirrors node-UPDATE → RLS refuses → 422.
    const write = await postLinkAttribute(tenant.ungranted, {
      attribute: 'link',
      spaceId: sid,
      nodeId: linkNodeId,
      url: 'https://attacker.example/overwrite',
    });
    expect(write.status).toBe(422);

    // READ: the satellite SELECT mirrors node-READ → zero rows under the
    // non-grantee's OWN JWT (the URL itself never leaks). The owner-side control
    // read is test 1's final assertion.
    const { data, error } = await tenant.ungranted.client
      .schema('kb')
      .from('resource_link')
      .select('url')
      .eq('node_id', linkNodeId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test('(5) an unauthenticated attribute write is refused (session required)', async () => {
    const anon = await request.newContext({
      baseURL: BASE,
      ignoreHTTPSErrors: true,
    });
    try {
      const res = await anon.post('/author/graph/attributes', {
        data: {
          attribute: 'link',
          spaceId: tenant.spaceId,
          nodeId: linkNodeId,
          url: LINK_URL,
        },
      });
      expect([401, 403]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });

  test('(6) copying a link node clones its satellite — the copy carries the same url/host on its OWN row', async () => {
    const owner = await seedClientFor(tenant.granted);
    try {
      const copy = await owner.copy(tenant.spaceId, linkNodeId, {
        rootTitle: `${linkTitle} (copy)`,
      });
      expect(copy.nodeId).not.toBe(linkNodeId);
      const { data, error } = await tenant.granted.client
        .schema('kb')
        .from('resource_link')
        .select('node_id,url,host')
        .eq('node_id', copy.nodeId);
      expect(error).toBeNull();
      expect(data).toEqual([
        { node_id: copy.nodeId, url: LINK_URL, host: LINK_HOST },
      ]);
    } finally {
      await owner.dispose();
    }
  });
});
