/**
 * Drive "Only files" filter + list Size column — the cross-lens uploaded-artifacts filter
 * and the recursive folder-size column over the resolved canvas + `kbData`. Making
 * `file`/`video` REAL (a `media` satellite with `byteSize`) let the Drive
 * add two purely-presentational capabilities:
 *
 *  1. the "Only files" toggle chip (`graph.drive.filterUploaded` = "Only files", an
 *     `aria-pressed` button):
 *     - FLAT mode (a flat lens / grid): keep ONLY uploaded artifacts (a `file`/`video`
 *       with real bytes) — folders/docs/links drop out;
 *     - TREE mode (KB browse list layout, an advanced/structural lens): PRUNE the
 *       containment to branches holding ≥1 artifact — ancestor folders on the path to a
 *       file survive, empty branches drop.
 *  2. the Size column (`graph.table.size` = "Size") in the list layout, with a
 *     visible-slice Hint (`graph.drive.folderSizeHint`):
 *     - a file/video row shows its humanized `byteSize` (`formatBytes`: B/KB/MB);
 *     - a folder row shows the RECURSIVE SUM of its VISIBLE descendant artifact bytes;
 *     - a text/link/tag row shows an em dash "—".
 *
 * The tree comes ENTIRELY from the shared `DRIVE_SIZE_FILTER_SCENARIO` catalog (the `drive`
 * + `media` presets, via `seedDriveSizeFilterFixture`) — no inline `createFolder`/`createDoc`/
 * upload tree — so the demo DB and this test name the SAME nodes through the ONE
 * create-vocabulary. Its two artifacts (a 512-byte file + a 512-byte video, nested in one
 * folder) have real `media` satellites uploaded through the product's own transport (the
 * predicate requires a real satellite, NOT a byte-less stub), so the folder-sum arithmetic
 * is exact: 512 + 512 = 1024 B → the folder Size cell reads "1 KB".
 *
 * Rendered in KB browse LIST layout (a collapsible containment TREE): this ONE lens covers
 * BOTH the pruned-TREE filter behaviour AND the folder-sum Size column, without the
 * entitlement-gated advanced lens. The list layout is selected via the `drive-layout=list`
 * cookie the view reads at SSR.
 *
 * Tagged `@full` — needs the running Supabase + author stack + REAL Storage (the artifacts
 * are uploaded through the real media transport at seed time).
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

// The i18n strings the size cells render (graph.media.bytes/kilobytes — these keys resolve
// in the running catalog). The two 512-byte artifacts → "512 B"; the nested folder-sum
// (512 + 512 = 1024) → "1 KB".
const SIZE_512 = '512 B';
const SIZE_1KB = '1 KB';
// A row with no uploaded artifact shows an em dash: a non-artifact leaf (text/link), AND
// a folder whose subtree holds no media (absent from the folder-size index → "—", not
// "0 B"). A folder WITH media that sums to 0 (only 0-byte files) would still show "0 B".
const EM_DASH = '—';

// The "Only files" chip + the "Size" column header are driven by the newer graph keys
// (graph.drive.filterUploaded, graph.table.size). Match BOTH the resolved label AND the raw
// key, so the spec is green whether or not the running app's catalog has been rebuilt to
// include them (the render itself is key-driven; the behaviour is identical either way).
const ONLY_FILES = /^(Only files|graph\.drive\.filterUploaded)$/;
const SIZE_HEADER = /Size|graph\.table\.size/;

/** A browser context authenticated AS the actor with the active space pinned AND the Drive
 * layout forced to LIST (the `drive-layout` cookie the view reads at SSR), so the browse
 * tree renders as the sortable table with the Size column. Mirrors the sibling render
 * specs' `pageFor`, plus the layout cookie. */
async function listPageFor(
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
    {
      name: 'drive-layout',
      value: 'list',
      domain: url.hostname,
      path: '/',
    },
  ]);
  return context.newPage();
}

/** The list/tree ROW for a node title. The DataTable makes each DATA row a clickable
 * `<tr role="button">` (single → Details, double → open), so `getByRole('row')` matches
 * ONLY the header — we target the `<tr>` element itself (role-agnostic) whose name cell
 * holds the exact title. Scoped to that row so a Size assertion reads THAT row's cells. */
function row(page: Page, title: string) {
  return page
    .locator('tr')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

/** Open the fixture root in KB browse list layout and wait for its tree table to render.
 * `?folder=<root>` resolves to the 'kb' browse scope (the default). The wait keys on the
 * list TABLE + the media branch row so a transient pre-hydration empty-state never trips it. */
async function openRoot(page: Page, fx: DriveSizeFilterFixture): Promise<void> {
  await page.goto(`/author/graph?folder=${fx.rootId}`, { timeout: 60_000 });
  // The browse tree renders as the sortable table (list layout). Wait for the media branch
  // row — it anchors the tree and never drops (it always holds artifacts).
  await expect(row(page, fx.titles.mediaBranch)).toBeVisible({
    timeout: 60_000,
  });
}

/** Expand a folder's tree row so its children render inline (click the expand chevron).
 * The chevron's aria-label is exactly "Expand folder"; the row itself is also `role=button`
 * (its name is the whole row text), so match the chevron by its EXACT label to avoid the row. */
async function expandFolder(page: Page, title: string): Promise<void> {
  const r = row(page, title);
  const expandBtn = r.getByRole('button', {
    name: 'Expand folder',
    exact: true,
  });
  const collapseBtn = r.getByRole('button', {
    name: 'Collapse folder',
    exact: true,
  });
  // The tree row paints from SSR before the client finishes hydrating, so an early click
  // lands on a not-yet-interactive chevron and silently no-ops (a hydration race, widened a
  // little by the size-index + toolbar first render). Retry the click until the expand
  // actually COMMITS — the chevron flips to "Collapse folder" — instead of clicking once
  // and hoping. `toPass` re-runs the block until it succeeds or the outer timeout.
  await expect(async () => {
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    }
    await expect(collapseBtn).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** The "Only files" toggle chip (an `aria-pressed` button). */
function onlyFilesChip(page: Page) {
  return page.getByRole('button', { name: ONLY_FILES });
}

test.describe('@full render — Drive "Only files" filter + list Size column', () => {
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

  // ── The Size column (list layout) ──────────────────────────────────────────

  test('(1) the Size column shows humanized bytes for artifacts, the recursive folder-sum for folders, and "—" for non-artifacts', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await listPageFor(context, fx.owner, fx.spaceId);
      await openRoot(page, fx);

      // The Size column header is present (its visible-slice Hint lives in the header cell).
      await expect(
        page.getByRole('columnheader', { name: SIZE_HEADER })
      ).toBeVisible({ timeout: 30_000 });

      // Expand the branch → its subfolder → so the two artifacts render as rows.
      await expandFolder(page, fx.titles.mediaBranch);
      await expandFolder(page, fx.titles.nested);

      // Each artifact leaf shows its OWN humanized byte size (512 B each).
      await expect(row(page, fx.titles.fileSmall)).toContainText(SIZE_512);
      await expect(row(page, fx.titles.videoSmall)).toContainText(SIZE_512);

      // The folder rows show the RECURSIVE SUM of their visible descendant artifact bytes:
      // nested = 512 + 512 = 1024 B → "1 KB"; media-branch (its only descendants are the
      // two artifacts) = the SAME 1 KB. The arithmetic assertion on the known tree.
      expect(fx.folderSum).toBe(fx.bytes.fileSmall + fx.bytes.videoSmall);
      expect(fx.folderSum).toBe(1024);
      await expect(row(page, fx.titles.nested)).toContainText(SIZE_1KB);
      await expect(row(page, fx.titles.mediaBranch)).toContainText(SIZE_1KB);

      // A non-artifact LEAF (a loose text doc / a loose link) shows the em dash "—"
      // (a leaf's own artifact bytes are null → the "—" cell).
      await expect(row(page, fx.titles.looseDoc)).toContainText(EM_DASH);
      await expect(row(page, fx.titles.looseLink)).toContainText(EM_DASH);

      // A FOLDER with NO descendant media (only a text doc) shows the em dash "—": a
      // subtree that holds no artifact is ABSENT from the folder-size index → "—" (NOT
      // "0 B"), consistent with a non-artifact leaf. (A folder WITH media summing to 0 —
      // only 0-byte files — would still show "0 B".)
      await expect(row(page, fx.titles.emptyBranch)).toContainText(EM_DASH);
    } finally {
      await context.close();
    }
  });

  // ── The "Only files" filter — TREE (KB browse list layout) prune ────────────

  test('(2) "Only files" prunes the containment tree to branches that hold an uploaded artifact', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page = await listPageFor(context, fx.owner, fx.spaceId);
      await openRoot(page, fx);

      // OFF: every child of the root is present (folders + loose leaves).
      const chip = onlyFilesChip(page);
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(row(page, fx.titles.mediaBranch)).toBeVisible();
      await expect(row(page, fx.titles.emptyBranch)).toBeVisible();
      await expect(row(page, fx.titles.looseDoc)).toBeVisible();
      await expect(row(page, fx.titles.looseLink)).toBeVisible();

      // Toggle ON.
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');

      // The media branch SURVIVES (its subtree holds artifacts) — its ancestor path is
      // kept so the files remain reachable in the tree.
      await expect(row(page, fx.titles.mediaBranch)).toBeVisible();
      // The empty branch (only a text doc), and the loose non-artifact leaves, DROP OUT.
      await expect(row(page, fx.titles.emptyBranch)).toHaveCount(0);
      await expect(row(page, fx.titles.looseDoc)).toHaveCount(0);
      await expect(row(page, fx.titles.looseLink)).toHaveCount(0);

      // Expanding the surviving branch shows ONLY the artifacts (the pruned leaves) —
      // no non-artifact children remain, and the text doc inside the empty branch is gone.
      await expandFolder(page, fx.titles.mediaBranch);
      await expandFolder(page, fx.titles.nested);
      await expect(row(page, fx.titles.fileSmall)).toBeVisible();
      await expect(row(page, fx.titles.videoSmall)).toBeVisible();
      await expect(row(page, fx.titles.docInside)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // ── The "Only files" filter — FLAT (Starred lens) keep-only-artifacts ───────

  test('(3) in FLAT mode (the Starred lens) "Only files" keeps only uploaded artifacts — a starred doc drops', async ({
    browser,
  }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      // The Starred lens is a FLAT digest (no containment tree): the two starred artifacts
      // AND the starred loose doc all list at one level. Grid layout keeps the flat render.
      const page = await listPageFor(context, fx.owner, fx.spaceId);
      await page.goto('/author/graph?scope=starred', { timeout: 60_000 });

      // OFF: the flat lens lists BOTH artifacts AND the starred non-artifact doc.
      const chip = onlyFilesChip(page);
      await expect(chip).toBeVisible({ timeout: 60_000 });
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(row(page, fx.titles.fileSmall)).toBeVisible();
      await expect(row(page, fx.titles.videoSmall)).toBeVisible();
      await expect(row(page, fx.titles.looseDoc)).toBeVisible();

      // Toggle ON → the flat lens keeps ONLY uploaded artifacts: the two files STAY, the
      // starred text doc (a non-artifact) DROPS OUT.
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(row(page, fx.titles.fileSmall)).toBeVisible();
      await expect(row(page, fx.titles.videoSmall)).toBeVisible();
      await expect(row(page, fx.titles.looseDoc)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
