/**
 * Shortcut authoring — create, follow, and remove a cross-folder symlink from the
 * Drive UI (ADR-0015 §3). A `shortcut` edge folder→target ("one canonical home,
 * many appearances") was renderable + seedable but had NO product gesture; this
 * covers the authoring path end-to-end through the REAL routes under the user's RLS:
 *
 *   1. Copy a node (the `⋯` clipboard), navigate INTO a folder, "Add as shortcut" →
 *      a `shortcut` edge is written (folder→target) and a symlink card appears in
 *      that folder. Remove it → the edge is deleted; ONLY the symlink goes, the
 *      target node + its canonical home survive.
 *   2. FOLLOWING a document shortcut (double-click / Open) reaches the SAME surface
 *      as opening the real node — the reader — not a dead Details panel. A symlink
 *      you cannot follow is pointless.
 *   3. RLS negative: a verb-less non-grantee cannot author a shortcut in the space.
 *
 * Each test uses its OWN target doc so no test depends on another's edge state. The
 * corpus is built through the SHARED seed client — one create-vocabulary for demo +
 * tests. Tagged `@full` — needs the running stack.
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

/** The CARD (grid tile) for a node — scoped to `div.group` so it never matches the
 * sidebar folder list. Mirrors the sibling render specs. */
function card(page: Page, title: string) {
  return page
    .locator('div.group', { has: page.getByText(title, { exact: true }) })
    .first();
}

/** A browser context authenticated AS the actor with the active space pinned.
 * `layout` forces the Drive layout the view reads at SSR (`drive-layout` cookie). */
async function pageFor(
  context: BrowserContext,
  actor: KnowledgeActor,
  spaceId: string,
  layout?: 'grid' | 'list'
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
    ...(layout
      ? [
          {
            name: 'drive-layout',
            value: layout,
            domain: url.hostname,
            path: '/',
          },
        ]
      : []),
  ]);
  return context.newPage();
}

test.describe('@full ADR-0015 shortcut authoring — create, follow + remove from the Drive UI', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let teamFolderId: string;
  const stamp = Date.now();
  const teamTitle = `Team Space ${stamp}`;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    const owner = await seedClientFor(tenant.granted);
    try {
      teamFolderId = await owner.createFolder(tenant.spaceId, teamTitle);
    } finally {
      await owner.dispose();
    }
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  /** Create a text doc AS the owner at root; returns its node id. */
  async function makeDoc(title: string): Promise<string> {
    const owner = await seedClientFor(tenant.granted);
    try {
      return (await owner.createDoc(tenant.spaceId, title)).nodeId;
    } finally {
      await owner.dispose();
    }
  }

  /** Seed a shortcut edge team→doc AS the owner (the create path is covered in test 1). */
  async function seedShortcut(docId: string): Promise<void> {
    const owner = await seedClientFor(tenant.granted);
    try {
      await owner.shortcut(tenant.spaceId, teamFolderId, docId);
    } finally {
      await owner.dispose();
    }
  }

  async function shortcutEdgeCount(docId: string): Promise<number> {
    const { data, error } = await tenant.service
      .from('knowledge_edges')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .eq('from_id', teamFolderId)
      .eq('to_id', docId)
      .eq('relation_type', 'shortcut');
    expect(error).toBeNull();
    return (data ?? []).length;
  }

  test('(1) copy → paste as shortcut inside a folder → the symlink card + edge appear, then remove clears both', async ({
    browser,
  }) => {
    const targetTitle = `Design Note ${stamp}`;
    const targetDocId = await makeDoc(targetTitle);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await page.goto('/author/graph', { timeout: 60_000 });

      // Copy the target doc via its `⋯` menu (marks the Dolphin clipboard).
      const rootCard = card(page, targetTitle);
      await expect(rootCard).toBeVisible({ timeout: 60_000 });
      await rootCard.getByRole('button', { name: 'More', exact: true }).click();
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: 'Copy' })
        .click();

      // Navigate INTO the container folder (double-click = Open).
      await card(page, teamTitle).dblclick();
      await expect(page.getByText(teamTitle).first()).toBeVisible({
        timeout: 30_000,
      });

      // The paste chip now offers "Add … as a shortcut" (folder-only). Click it.
      const pasteShortcut = page.getByRole('button', {
        name: new RegExp(`Add.*${stamp}.*shortcut`, 'i'),
      });
      await expect(pasteShortcut).toBeVisible({ timeout: 30_000 });
      await pasteShortcut.click();

      // A symlink card for the target appears inside the folder; the edge is written.
      const shortcutCard = card(page, targetTitle);
      await expect(shortcutCard).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        expect(await shortcutEdgeCount(targetDocId)).toBe(1);
      }).toPass({ timeout: 15_000 });

      // Remove the shortcut from its card — only the symlink goes.
      await shortcutCard
        .getByTestId('drive-remove-shortcut')
        .click({ force: true });
      await expect(async () => {
        expect(await shortcutEdgeCount(targetDocId)).toBe(0);
      }).toPass({ timeout: 15_000 });
      await expect(card(page, targetTitle)).toHaveCount(0, { timeout: 30_000 });

      // The target node itself SURVIVES (canonical home at root untouched).
      const { data: node } = await tenant.service
        .from('knowledge_resources')
        .select('id,status')
        .eq('id', targetDocId)
        .single();
      expect(node?.status).toBe('active');
    } finally {
      await context.close();
    }
  });

  test('(2) following a document shortcut opens the reader (a symlink you can actually use)', async ({
    browser,
  }) => {
    const followTitle = `Followed Note ${stamp}`;
    const followDocId = await makeDoc(followTitle);
    await seedShortcut(followDocId);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await pageFor(context, tenant.granted, tenant.spaceId);
      await page.goto('/author/graph', { timeout: 60_000 });

      // Enter the folder that holds the shortcut, then double-click the symlink card.
      await card(page, teamTitle).dblclick();
      const shortcutCard = card(page, followTitle);
      await expect(shortcutCard).toBeVisible({ timeout: 30_000 });
      await shortcutCard.dblclick();

      // Following the shortcut OPENS the document (the reader), reaching the target's
      // canonical id — NOT a dead selection. The URL carries the opened doc.
      await expect
        .poll(() => page.url(), { timeout: 30_000 })
        .toContain(`doc=${followDocId}`);
    } finally {
      await context.close();
    }
  });

  test('(3) the LIST view exposes "Open in KB" on a shortcut row → jumps to the target\'s canonical home', async ({
    browser,
  }) => {
    const listTitle = `Listed Note ${stamp}`;
    const listDocId = await makeDoc(listTitle);
    await seedShortcut(listDocId);

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      // Open the folder DIRECTLY in LIST layout (the `drive-layout` cookie forces it
      // at SSR); the shortcut renders as a table row.
      const page = await pageFor(
        context,
        tenant.granted,
        tenant.spaceId,
        'list'
      );
      await page.goto(`/author/graph?folder=${teamFolderId}`, {
        timeout: 60_000,
      });

      // In LIST layout a row is a `<tr role="button">` (its accessible NAME folds in
      // every cell + the actions), NOT a `div.group` grid card nor a `row` role.
      const shortcutRow = page
        .getByRole('button', { name: new RegExp(listTitle) })
        .first();
      await expect(shortcutRow).toBeVisible({ timeout: 60_000 });
      // "Open in KB" must be VISIBLE in the table cell (reveal='always' — a grid-style
      // hover reveal would render zero-size here). Then it navigates to the target's
      // canonical home (root), leaving the team folder.
      const openInKb = shortcutRow.getByRole('button', { name: 'Open in KB' });
      await expect(openInKb).toBeVisible({ timeout: 30_000 });
      // Retry the WHOLE click→navigate cycle: a single click on the in-cell button can
      // miss (nested inside the row `<tr role=button>`; a background re-render can detach
      // it mid-click), leaving the URL unchanged. Each attempt short-circuits once we've
      // already left the team folder, so a late-landing navigation still passes.
      const inTeamFolder = () =>
        new URL(page.url()).searchParams.get('folder') === teamFolderId;
      await expect(async () => {
        if (!inTeamFolder()) {
          return; // reveal already jumped to the target's canonical home (root)
        }
        await openInKb.click({ timeout: 3_000 });
        expect(inTeamFolder()).toBe(false);
      }).toPass({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  test('(4) RLS negative: a verb-less non-grantee cannot author a shortcut in the space', async () => {
    const guardTitle = `Guarded Note ${stamp}`;
    const guardDocId = await makeDoc(guardTitle);

    const outsider = await seedClientFor(tenant.ungranted);
    try {
      const res = await outsider.post('/author/graph/edges', {
        action: 'shortcut',
        spaceId: tenant.spaceId,
        folderId: teamFolderId,
        targetId: guardDocId,
      });
      // RLS (create verb) refuses — a clean failure, never a 201, and no edge row.
      expect(res.status).not.toBe(201);
      expect(await shortcutEdgeCount(guardDocId)).toBe(0);
    } finally {
      await outsider.dispose();
    }
  });
});
