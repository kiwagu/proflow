/**
 * Per-user gating acceptance test — slice 05 (docs/knowledge-graph-plan.md §2).
 *
 * Turns the slice-04 STATIC course lock into a REAL one driven by per-user
 * progress. Proves the carrying boundary "authorization ≠ gating" (ADR-0004 §3):
 * RLS lets a user READ every course step (they all stay in the result), while the
 * lock is a COMPUTED display state over the user's own `resource_user_state`.
 *
 * The demo graph (three lessons L1→L2→L3 chained by `prerequisite`, a saved
 * `course` projection) lives in the harness, never a migration — the lesson from
 * identity-sync. Two granted actors (A, B) prove own-rows isolation; a read-only
 * actor proves the read/progress verb split. All writes go through the REAL
 * `/author/graph/progress` endpoint under the actor's Supabase session, and the
 * REAL `/author/graph/[projectionId]` page renders the gated course.
 *
 * Coverage maps to §7:
 *  (1) fresh user → step 1 open, steps 2/3 locked (dynamic, from empty state).
 *  (2) mark complete step 1 → step 2 unlocks (lock driven by per-user state).
 *  (3) isolation: B's progress is invisible to A (own-rows by user_id).
 *  (4) RLS rejects writing ANOTHER user's row (user_id = auth.uid() WITH CHECK).
 *  (5) progress write requires space.knowledge.progress; reading uses read.
 *  (6) a locked step REMAINS in the result/DOM (lock = display, not absence).
 *
 * Tagged `@full` — needs the running author app + Supabase.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  bootstrapPerUserGatingActors,
  seedProjectionEngineDemo,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type PerUserGatingActors,
  type ProjectionEngineGraph,
} from './helpers/knowledge-graph-bootstrap.js';

const GRAPH_BASE = '/author/graph';
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

const LOCK_TOOLTIP = 'complete the previous step to unlock';
const MARK_COMPLETE = 'mark complete';

const L1 = 'Lesson 1 — Foundations';
const L2 = 'Lesson 2 — Building Blocks';
const L3 = 'Lesson 3 — Putting It Together';

/** Playwright context with the actor's @supabase/ssr cookies + the active space. */
async function actorHttp(
  actor: KnowledgeActor,
  spaceId: string,
  baseURL: string
) {
  const cookies = await actorSsrAuthCookies(actor);
  const cookieHeader = [
    ...cookies.map((c) => `${c.name}=${c.value}`),
    `${ACTIVE_SPACE_COOKIE}=${spaceId}`,
  ].join('; ');
  return playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Cookie: cookieHeader },
  });
}

/** Count how many times the locked-step tooltip appears in the rendered HTML. */
function lockCount(html: string): number {
  return html.toLowerCase().split(LOCK_TOOLTIP).length - 1;
}

test.describe('knowledge per-user gating (dynamic course locks) @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let graph: ProjectionEngineGraph;
  let gatingActors: PerUserGatingActors;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    graph = await seedProjectionEngineDemo(tenant);
    gatingActors = await bootstrapPerUserGatingActors(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        gatingActors?.extraUserIds ?? []
      );
    }
  });

  test('(1) fresh user → step 1 open, steps 2/3 locked', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const res = await http.get(`${GRAPH_BASE}/${graph.courseProjectionId}`);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // All three lessons render in prerequisite order (RLS let them all be read).
      const idxL1 = html.indexOf(L1);
      const idxL2 = html.indexOf(L2);
      const idxL3 = html.indexOf(L3);
      expect(idxL1).toBeGreaterThanOrEqual(0);
      expect(idxL2).toBeGreaterThan(idxL1);
      expect(idxL3).toBeGreaterThan(idxL2);

      // Step 1 is open → it carries a mark-complete action. Steps 2 and 3 are
      // locked by the prerequisite → exactly two lock tooltips, no L3-yet action.
      expect(html.toLowerCase()).toContain(MARK_COMPLETE);
      expect(lockCount(html)).toBe(2);
    } finally {
      await http.dispose();
    }
  });

  test('(2) mark complete step 1 → step 2 unlocks', async ({ baseURL }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      // Mark L1 done through the REAL endpoint (under the actor's RLS session).
      const post = await http.post(`${GRAPH_BASE}/progress`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.lessonIds[0],
          coarseStatus: 'done',
        },
      });
      expect(post.status(), await post.text()).toBe(200);

      // Re-render: L1 done (badge), L2 unlocked, L3 still locked → one lock left.
      const afterL1 = await http.get(
        `${GRAPH_BASE}/${graph.courseProjectionId}`
      );
      const htmlL1 = await afterL1.text();
      expect(htmlL1.toLowerCase()).toContain('done');
      expect(lockCount(htmlL1)).toBe(1);

      // Completing L2 unlocks L3 → no locks remain.
      const post2 = await http.post(`${GRAPH_BASE}/progress`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.lessonIds[1],
          coarseStatus: 'done',
        },
      });
      expect(post2.status(), await post2.text()).toBe(200);

      const afterL2 = await http.get(
        `${GRAPH_BASE}/${graph.courseProjectionId}`
      );
      const htmlL2 = await afterL2.text();
      expect(lockCount(htmlL2)).toBe(0);
    } finally {
      await http.dispose();
    }
  });

  test("(3) isolation: actor B's progress does not affect actor A", async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    // B marks L1 done in the SAME space.
    const httpB = await actorHttp(gatingActors.actorB, tenant.spaceId, base);
    try {
      const postB = await httpB.post(`${GRAPH_BASE}/progress`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.lessonIds[0],
          coarseStatus: 'done',
        },
      });
      expect(postB.status(), await postB.text()).toBe(200);
    } finally {
      await httpB.dispose();
    }

    // Actor A (the fresh `ungranted`? no — use the read-only reader which has a
    // clean slate AND read access) sees its OWN empty state: L1 open, L2/L3
    // locked — B's row is invisible (own-rows RLS by user_id).
    const httpA = await actorHttp(gatingActors.reader, tenant.spaceId, base);
    try {
      const res = await httpA.get(`${GRAPH_BASE}/${graph.courseProjectionId}`);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();
      expect(html).toContain(L1);
      // The reader has its own empty overlay → two lock tooltips (L2, L3).
      expect(lockCount(html)).toBe(2);
    } finally {
      await httpA.dispose();
    }
  });

  test("(4) RLS rejects writing another user's state row", async () => {
    // Direct table write under actor A's RLS client, forging B's user_id → the
    // INSERT WITH CHECK (user_id = auth.uid()) is the final gate and denies it.
    const { error } = await tenant.granted.client
      .from('resource_user_state')
      .insert({
        user_id: gatingActors.actorB.userId, // forged foreign owner
        resource_id: graph.lessonIds[0],
        space_id: tenant.spaceId,
        coarse_status: 'done',
      });
    expect(error).not.toBeNull();

    // And the forged row was NOT written — B has no L1 row created by A. (Read
    // under B: B never wrote it in this test path; assert no done row exists for
    // L1 under B that A could have planted.) Verify via service-role count = the
    // only L1-done rows are ones legitimately written by their owners.
    const { data: rows, error: readErr } = await tenant.service
      .from('resource_user_state')
      .select('user_id')
      .eq('resource_id', graph.lessonIds[0])
      .eq('user_id', gatingActors.actorB.userId);
    expect(readErr).toBeNull();
    // B's own L1 row exists from test (3) where B legitimately marked it done;
    // crucially it was written by B, not planted by A. The forged insert above
    // simply errored — no extra/duplicate row appeared (unique user,resource).
    expect((rows ?? []).length).toBe(1);
  });

  test('(5) progress write requires space.knowledge.progress; read uses read', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(gatingActors.reader, tenant.spaceId, base);
    try {
      // The reader CAN read the course (space.knowledge.read) — it renders.
      const page = await http.get(`${GRAPH_BASE}/${graph.courseProjectionId}`);
      expect(page.status(), await page.text()).toBe(200);
      expect(await page.text()).toContain(L1);

      // But it CANNOT write progress (lacks space.knowledge.progress) → the
      // endpoint surfaces the RLS rejection as a clean 422 (nothing written).
      const post = await http.post(`${GRAPH_BASE}/progress`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.lessonIds[0],
          coarseStatus: 'done',
        },
      });
      expect(post.status()).toBe(422);
    } finally {
      await http.dispose();
    }

    // The reader still has NO progress row for L1 (the write was denied).
    const { data: rows, error } = await tenant.service
      .from('resource_user_state')
      .select('id')
      .eq('resource_id', graph.lessonIds[0])
      .eq('user_id', gatingActors.reader.userId);
    expect(error).toBeNull();
    expect((rows ?? []).length).toBe(0);
  });

  test('(6) a locked step remains present (authorization ≠ gating)', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    // Use the reader: clean overlay → L3 is locked, yet it MUST still render.
    const http = await actorHttp(gatingActors.reader, tenant.spaceId, base);
    try {
      const res = await http.get(`${GRAPH_BASE}/${graph.courseProjectionId}`);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // L3 is locked (clean overlay), but the node is STILL in the DOM — the
      // lock is display state, not an access denial. RLS let it be read.
      expect(html).toContain(L3);
      expect(lockCount(html)).toBe(2);
    } finally {
      await http.dispose();
    }
  });
});
