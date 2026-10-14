import type { Page, Request } from '@playwright/test';

import { expect, test } from './fixtures.js';
import { loginViaUi } from './helpers/auth.js';
import {
  bootstrapOrgSpaceAdminForUser,
  deleteOrganizationCascade,
} from './helpers/platform-org-bootstrap.js';

/**
 * What an open workbench costs the server while nothing happens, and what
 * a reader costs while someone types.
 *
 * Idle, one browser asks the server once a minute — the change probe, the
 * presence beat and the session check — plus a full pass every five
 * minutes; a second tab of the same browser builds nothing and adds only
 * its own session check. Every request of the replica goes to the backend
 * mount on the page's own origin, never to the API host.
 *
 * The nudge channel must be up before anything is counted: with a broken
 * edge (no WebSocket upgrade on the backend mount) the workbench still
 * converges, on a 15 s heartbeat, and only this check tells the two apart.
 */

/**
 * Each idle window starts right after a heartbeat the leader was seen to
 * send, and lasts a little longer than its one-minute interval: anchored
 * at an arbitrary phase, a 60 s window could end a few milliseconds before
 * the next beat (timer latency) and count none.
 */
const IDLE_MS = 65_000;
const TYPING_MS = 30_000;
/** Above the startup catch-up's five-second echo. */
const SETTLE_MS = 7_000;

type Tally = { total: number; buckets: Record<string, number> };

/** Records every HTTP request the given pages make until stopped. */
function record(pages: Page[]) {
  const seen: string[] = [];
  const listener = (request: Request) => {
    if (/^https?:/.test(request.url())) seen.push(request.url());
  };
  for (const page of pages) page.on('request', listener);
  return {
    stop(): Tally & { urls: string[] } {
      for (const page of pages) page.off('request', listener);
      const buckets: Record<string, number> = {};
      for (const url of seen) {
        const { host, pathname } = new URL(url);
        const bucket =
          host !== 'proflow.local'
            ? host
            : pathname.startsWith('/backend/')
              ? pathname.replace(
                  /^\/backend\/(rest\/v1\/(rpc\/)?)?/,
                  'backend:'
                )
              : pathname;
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      }
      return { total: seen.length, buckets, urls: [...seen] };
    },
  };
}

/**
 * The minute held what idle is supposed to cost, not merely less: the
 * change probe, the presence beat and the session check each ran.
 */
function expectHeartbeat(tally: Tally) {
  expect(tally.buckets['backend:sync_probe'] ?? 0).toBeGreaterThanOrEqual(1);
  expect(
    tally.buckets['backend:sync_presence_beat'] ?? 0
  ).toBeGreaterThanOrEqual(1);
  expect(
    tally.buckets['/platform/api/workbench/session'] ?? 0
  ).toBeGreaterThanOrEqual(1);
}

/** The leader's next change probe: where an idle window starts. */
function nextHeartbeat(leader: Page) {
  return leader.waitForRequest(
    (request) => request.url().includes('/backend/rest/v1/rpc/sync_probe'),
    { timeout: 90_000 }
  );
}

async function channelUp(page: Page) {
  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.dataset.syncChannel),
      {
        timeout: 60_000,
      }
    )
    .toBe('up');
}

test.describe('Workbench sync traffic', () => {
  test('@full an idle workbench costs under ten requests a minute, a second tab adds only its session check, and a reader converges while someone types', async ({
    browser,
    page,
    seededUser,
  }) => {
    test.setTimeout(600_000);
    const org = await bootstrapOrgSpaceAdminForUser(seededUser.id);
    const deviceB = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      await loginViaUi(page, seededUser, '/author');
      await expect(page.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.syncLeader)
        )
        .toBe('1');
      await channelUp(page);
      await page.waitForTimeout(SETTLE_MS);

      // One tab, idle for a minute (and the margin above).
      await nextHeartbeat(page);
      const oneTab = record([page]);
      await page.waitForTimeout(IDLE_MS);
      const idleOneTab = oneTab.stop();
      console.log('idle, one tab:', JSON.stringify(idleOneTab.buckets));
      expect(
        idleOneTab.urls.filter((url) => url.includes('api.proflow.local'))
      ).toEqual([]);
      expect(idleOneTab.total).toBeLessThanOrEqual(10);
      expectHeartbeat(idleOneTab);

      // A second tab of the same browser: it syncs nothing itself.
      const second = await page.context().newPage();
      await second.goto('/author/');
      await expect(second.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await expect
        .poll(() =>
          second.evaluate(() => document.documentElement.dataset.syncLeader)
        )
        .toBe('0');
      expect(
        await second.evaluate(
          () => document.documentElement.dataset.syncChannel ?? null
        )
      ).toBeNull();
      await page.waitForTimeout(SETTLE_MS);
      await nextHeartbeat(page);
      const twoTabs = record([page, second]);
      await page.waitForTimeout(IDLE_MS);
      const idleTwoTabs = twoTabs.stop();
      console.log('idle, two tabs:', JSON.stringify(idleTwoTabs.buckets));
      expect(
        idleTwoTabs.urls.filter((url) => url.includes('api.proflow.local'))
      ).toEqual([]);
      expect(idleTwoTabs.total).toBeLessThanOrEqual(10);
      expectHeartbeat(idleTwoTabs);
      await second.close();

      // Typing: this device writes a document, a second device reads it.
      await page.getByTestId('new-document').click();
      const editor = page.locator('[contenteditable="true"]').first();
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.click();
      await editor.pressSequentially('Reader check.');
      const reader = await deviceB.newPage();
      await loginViaUi(reader, seededUser, '/author');
      await expect(reader.getByTestId('workbench-ready')).toBeVisible({
        timeout: 120_000,
      });
      await channelUp(reader);
      const row = reader
        .getByTestId('files-section')
        .getByTestId('file-row')
        .first();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.click();
      const readerEditor = reader.locator('[contenteditable="true"]').first();
      await expect(readerEditor).toHaveText('Reader check.', {
        timeout: 60_000,
      });
      await reader.waitForTimeout(SETTLE_MS);

      // Thirty seconds of typing in bursts: a word, then a pause long enough
      // for the edit to settle and be pushed.
      const typing = record([reader]);
      const words: string[] = [];
      const started = Date.now();
      for (let i = 0; Date.now() - started < TYPING_MS; i++) {
        const word = ` word${i}`;
        await editor.pressSequentially(word, { delay: 40 });
        words.push(word);
        await page.waitForTimeout(2_000);
      }
      const typing30s = typing.stop();
      console.log('typing, reader:', JSON.stringify(typing30s.buckets));
      expect(Number.isFinite(typing30s.total)).toBe(true);
      // And the reader has all of it: every word, in order.
      const typed = 'Reader check.' + words.join('');
      await expect(readerEditor).toHaveText(typed, { timeout: 60_000 });

      console.log(
        JSON.stringify({
          idleOneTab: idleOneTab.total,
          idleTwoTabs: idleTwoTabs.total,
          typing30sReaderRequests: typing30s.total,
        })
      );
    } finally {
      await deviceB.close();
      await deleteOrganizationCascade(org.organizationId);
    }
  });
});
