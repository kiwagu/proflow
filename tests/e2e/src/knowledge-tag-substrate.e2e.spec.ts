/**
 * KB tags made REAL (ADR-0003 Variant B) — a tag is an ORDINARY node (`kind='tag'`)
 * and "resource R has tag T" a directed `tagged` edge (from=R → to=T); there is NO
 * tag table or column (Invariant #1: one graph). The backend (the `action:'tag'`
 * edge route + the idempotent `tagResource` fan-out + the tagged-traversal engine)
 * already existed — this slice brings it to the eyes: the read-path (per-item tags +
 * the space tag vocabulary), the ResourcePanel tag editor, the Drive card tag chips,
 * and the lens tag facet. This spec covers exactly that NEW surface; the data plane
 * (traversal / projection) is already covered by `knowledge-graph-invariant` +
 * `knowledge-projection-engine`, so it is NOT duplicated here.
 *
 *  Write (the authoring vocabulary, idempotent by title):
 *   1  tagging by TITLE creates the `kind='tag'` node once + a `tagged` edge; a
 *      second tag with the SAME title REUSES the tag node (no duplicate) and is a
 *      no-op on the edge — the create-or-link fan-out.
 *
 *  Read-path (the eyes):
 *   2  the Drive card shows the tag as a chip; the ResourcePanel tag section shows
 *      it too; a free-text add in the panel makes a new chip appear on the card.
 *
 *  Facet (the lens filter):
 *   3  the tag-facet chip row lists the tag; toggling it narrows the canvas to the
 *      tagged node (the untagged sibling drops); "All" clears it back.
 *
 *  Untag:
 *   4  removing the chip in the panel deletes the `tagged` edge — the chip leaves the
 *      card.
 *
 *  RLS / access (the fence is the node row policy, not an app filter):
 *   5  a member with NO knowledge verbs sees neither the owner's private node, its
 *      `tagged` edges, nor the private tag node (a tag rides the same RLS as any
 *      node — space-global means "no separate tag-visibility model", never "public").
 *
 * Driven over HTTP through the SHARED seed client (`tag` = the REAL `action:'tag'`
 * edge route under the acting user's RLS) — one create-vocabulary for demo + tests.
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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
// ACTIVE_SPACE_COOKIE) — inlined to keep the e2e package dep-free, as the siblings do.
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

const TAG_TITLE = 'Design';
const SECOND_TAG_TITLE = 'Roadmap';

/** The CARD (grid tile) for a node — scoped to `div.group` so it never matches the
 * sidebar folder list. Mirrors the sibling render specs. */
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

test.describe('@full ADR-0003 KB tags — real tagged edges, read-path + facet + RLS', () => {
  test.describe.configure({ timeout: 240_000 });

  let tenant: KnowledgeGraphTenant;
  /** The OWNED, tagged node (`Design`) + an untagged sibling (`Beta`), both private
   * to `granted` — created once, tagged in `beforeAll`. */
  let taggedTitle: string;
  let siblingTitle: string;
  let taggedNodeId: string;
  let tagNodeId: string;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    const stamp = Date.now();
    taggedTitle = `Tagged Alpha ${stamp}`;
    siblingTitle = `Untagged Beta ${stamp}`;
    const owner = await seedClientFor(tenant.granted);
    try {
      taggedNodeId = (await owner.createDoc(tenant.spaceId, taggedTitle))
        .nodeId;
      await owner.createDoc(tenant.spaceId, siblingTitle);
      // Tag Alpha by TITLE → create-or-link: the tag node is created + the `tagged`
      // edge landed. The sibling stays untagged (the facet's negative).
      await owner.tag(tenant.spaceId, taggedNodeId, { tagTitle: TAG_TITLE });
    } finally {
      await owner.dispose();
    }
    // Resolve the created tag node's id (kind='tag', title=Design) under the owner RLS.
    const { data } = await tenant.granted.client
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .eq('kind', 'tag')
      .eq('title', TAG_TITLE)
      .is('deleted_at', null);
    tagNodeId = (data ?? [])[0]?.id as string;
    expect(tagNodeId, 'the tag node was created by tagging').toBeTruthy();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('(1) tagging by title is idempotent — one tag node, one edge, reused on re-tag', async () => {
    const owner = await seedClientFor(tenant.granted);
    try {
      // Re-tag Alpha with the SAME title — the fan-out resolves the existing tag node
      // and the existing edge; no duplicate node, no duplicate edge.
      await owner.tag(tenant.spaceId, taggedNodeId, { tagTitle: TAG_TITLE });
    } finally {
      await owner.dispose();
    }

    // Exactly ONE tag node titled `Design`.
    const { data: tagNodes, error: tagErr } = await tenant.granted.client
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .eq('kind', 'tag')
      .eq('title', TAG_TITLE)
      .is('deleted_at', null);
    expect(tagErr).toBeNull();
    expect(tagNodes).toEqual([{ id: tagNodeId }]);

    // Exactly ONE `tagged` edge Alpha → the tag node (from=resource, to=tag).
    const { data: edges, error: edgeErr } = await tenant.granted.client
      .from('knowledge_edges')
      .select('from_id,to_id')
      .eq('space_id', tenant.spaceId)
      .eq('relation_type', 'tagged')
      .eq('from_id', taggedNodeId);
    expect(edgeErr).toBeNull();
    expect(edges).toEqual([{ from_id: taggedNodeId, to_id: tagNodeId }]);
  });

  test('(2) the card + panel show the tag; a free-text add makes a new chip', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await page.goto('/author/graph', { timeout: 60_000 });

      // The card tag chip (read-path over `tagsByItem`).
      const tile = card(page, taggedTitle);
      await expect(tile).toBeVisible({ timeout: 60_000 });
      await expect(tile.getByText(TAG_TITLE, { exact: true })).toBeVisible();

      // Single-click → Details panel; the tag section shows the same tag.
      await tile.getByText(taggedTitle, { exact: true }).click();
      const panel = page.getByRole('complementary', { name: taggedTitle });
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText(TAG_TITLE, { exact: true })).toBeVisible();

      // Free-text add — type a new title + the + button → a `tagged` edge lands and
      // the new chip appears on the card after the refresh.
      await panel.getByPlaceholder(/Add a tag/i).fill(SECOND_TAG_TITLE);
      await panel.getByRole('button', { name: /Add a tag/i }).click();
      await expect(
        card(page, taggedTitle).getByText(SECOND_TAG_TITLE, { exact: true })
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('(3) the tag facet narrows the canvas to the tagged node; "All" clears it', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await page.goto('/author/graph', { timeout: 60_000 });

      // Both siblings visible at root before filtering.
      await expect(card(page, taggedTitle)).toBeVisible({ timeout: 60_000 });
      await expect(card(page, siblingTitle)).toBeVisible();

      // The facet chip (a ToggleChip = Button) named after the tag. The card chip is a
      // span (not a button), so this targets the facet row unambiguously.
      const facetChip = page.getByRole('button', {
        name: TAG_TITLE,
        exact: true,
      });
      await expect(facetChip).toBeVisible();
      await facetChip.click();

      // The untagged sibling drops; the tagged node remains.
      await expect(card(page, siblingTitle)).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(card(page, taggedTitle)).toBeVisible();

      // "All" clears the facet — the sibling returns.
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await expect(card(page, siblingTitle)).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('(4) removing the chip in the panel untags the node — the chip leaves the card', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await page.goto('/author/graph', { timeout: 60_000 });

      const tile = card(page, taggedTitle);
      await expect(tile.getByText(TAG_TITLE, { exact: true })).toBeVisible({
        timeout: 60_000,
      });
      await tile.getByText(taggedTitle, { exact: true }).click();
      const panel = page.getByRole('complementary', { name: taggedTitle });
      await expect(panel).toBeVisible({ timeout: 30_000 });

      // The remove-chip carries the `Remove tag` accessible name. There is one per tag;
      // scope to the Design chip's row by taking the button nearest its label.
      const designChip = panel
        .locator('span', { has: page.getByText(TAG_TITLE, { exact: true }) })
        .first();
      await designChip.getByRole('button', { name: /Remove tag/i }).click();

      // The tag chip leaves the card (the `tagged` edge was deleted).
      await expect(
        card(page, taggedTitle).getByText(TAG_TITLE, { exact: true })
      ).toHaveCount(0, { timeout: 30_000 });

      // The edge is gone in the graph (data mirror of the UI).
      const { data } = await tenant.granted.client
        .from('knowledge_edges')
        .select('to_id')
        .eq('space_id', tenant.spaceId)
        .eq('relation_type', 'tagged')
        .eq('from_id', taggedNodeId)
        .eq('to_id', tagNodeId);
      expect(data).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('(5) a member with no knowledge verbs sees neither the node, its tagged edges, nor the private tag', async () => {
    // The `ungranted` actor holds `space_admin` only (no `space.knowledge.*` verb),
    // so RLS admits NOTHING in the knowledge plane under its own JWT: not the owner's
    // node, not its `tagged` edges, not the private tag node. A tag rides the SAME row
    // policy as any resource — space-global is "no separate tag-visibility model", not
    // "public". The fence is the node RLS, never an app filter.
    const asOutsider = tenant.ungranted.client;

    const { data: nodes, error: nodeErr } = await asOutsider
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .in('id', [taggedNodeId, tagNodeId]);
    expect(nodeErr).toBeNull();
    expect(nodes).toEqual([]);

    const { data: edges, error: edgeErr } = await asOutsider
      .from('knowledge_edges')
      .select('from_id')
      .eq('space_id', tenant.spaceId)
      .eq('relation_type', 'tagged')
      .eq('from_id', taggedNodeId);
    expect(edgeErr).toBeNull();
    expect(edges).toEqual([]);
  });
});
