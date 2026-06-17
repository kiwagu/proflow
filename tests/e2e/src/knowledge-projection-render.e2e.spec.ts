/**
 * Projection-render acceptance test — slice 04 (docs/knowledge-graph-plan.md §6).
 *
 * Proves the CONSUMER render surface: the same graph renders as a knowledge-base
 * grid AND a course path by switching the saved projection (visible Invariant #1).
 * Drives the REAL `/author/graph/[projectionId]` server pages over HTTP as the
 * granted actor (Supabase session → the page's RLS client), and asserts the
 * rendered HTML. RLS is the sole access authority — an ungranted user resolves to
 * an empty set and sees the grid empty-state. The demo graph lives in the harness,
 * never a migration.
 *
 * Coverage maps to §7:
 *  (1) KB projection → grid cards for the tagged lessons only.
 *  (2) course projection → ordered steps L1→L2→L3; a fresh user sees the later
 *      steps gated by per-user prerequisite state (slice-05).
 *  (3) the switcher toggles KB ⇄ course over ONE graph.
 *  (4) RLS: ungranted → empty grid (not an error).
 *  (5) guest GET page → sign-in redirect; guest POST endpoint → 401 JSON (slice-03).
 *
 * Registry extensibility (an unknown `view` key → graceful fallback) is proven by
 * the unit `apps/author/tests/int/projection-view-registry.int.spec.ts`, the
 * presentational layer where it lives — no graph data is needed to exercise it.
 *
 * Tagged `@full` — needs the running author app + Supabase.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  seedProjectionEngineDemo,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type ProjectionEngineGraph,
} from './helpers/knowledge-graph-bootstrap.js';

const GRAPH_BASE = '/author/graph';

/** Canonical active-space cookie shared by the gateway shells (see gateway-auth). */
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

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

test.describe('knowledge projection render (grid ⇆ course over one graph) @full', () => {
  test.describe.configure({ timeout: 120_000 });

  let tenant: KnowledgeGraphTenant;
  let graph: ProjectionEngineGraph;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    graph = await seedProjectionEngineDemo(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
  });

  test('(1) KB projection renders a grid of the tagged lessons only', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const res = await http.get(
        `${GRAPH_BASE}/${graph.knowledgeBaseProjectionId}`
      );
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // Tagged lessons (L1, L2) appear; the untagged L3 does NOT, and the tag
      // node title is not a card (kind='tag' is filtered out).
      expect(html).toContain('Lesson 1 — Foundations');
      expect(html).toContain('Lesson 2 — Building Blocks');
      expect(html).not.toContain('Lesson 3 — Putting It Together');
    } finally {
      await http.dispose();
    }
  });

  test('(2) course projection renders ordered steps with per-user gating', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const res = await http.get(`${GRAPH_BASE}/${graph.courseProjectionId}`);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // All three lessons render in prerequisite order L1 → L2 → L3.
      const idxL1 = html.indexOf('Lesson 1 — Foundations');
      const idxL2 = html.indexOf('Lesson 2 — Building Blocks');
      const idxL3 = html.indexOf('Lesson 3 — Putting It Together');
      expect(idxL1).toBeGreaterThanOrEqual(0);
      expect(idxL2).toBeGreaterThan(idxL1);
      expect(idxL3).toBeGreaterThan(idxL2);

      // Dynamic gating for a fresh user (no progress rows): the first step is
      // open and later steps are locked by the prerequisite, so the per-user
      // lock tooltip string is rendered.
      expect(html.toLowerCase()).toContain(
        'complete the previous step to unlock'
      );
    } finally {
      await http.dispose();
    }
  });

  test('(3) the switcher toggles KB ⇆ course over the SAME graph', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      // Both projections are offered by the switcher on each page (one graph,
      // two saved apps), and each page renders its own view distinctly.
      const kb = await http.get(
        `${GRAPH_BASE}/${graph.knowledgeBaseProjectionId}`
      );
      const kbHtml = await kb.text();
      expect(kbHtml).toContain('Knowledge Base');
      expect(kbHtml).toContain('Intro Course');

      const course = await http.get(
        `${GRAPH_BASE}/${graph.courseProjectionId}`
      );
      const courseHtml = await course.text();
      expect(courseHtml).toContain('Knowledge Base');
      expect(courseHtml).toContain('Intro Course');

      // The KB grid renders no lock tooltip; the course path does — proving the
      // SAME node set takes two forms purely by `view`.
      expect(kbHtml.toLowerCase()).not.toContain(
        'complete the previous step to unlock'
      );
      expect(courseHtml.toLowerCase()).toContain(
        'complete the previous step to unlock'
      );
    } finally {
      await http.dispose();
    }
  });

  test('(4) RLS: an ungranted user sees the grid empty-state, not an error', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    try {
      // The projection row itself is RLS-invisible to ungranted, so the page
      // redirects to the index, which shows the no-projections empty-state.
      const res = await http.get(
        `${GRAPH_BASE}/${graph.knowledgeBaseProjectionId}`
      );
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // No domain rows leak: none of the seeded lesson titles render.
      expect(html).not.toContain('Lesson 1 — Foundations');
      expect(html).not.toContain('Lesson 2 — Building Blocks');
      expect(html).not.toContain('Lesson 3 — Putting It Together');
    } finally {
      await http.dispose();
    }
  });

  test('(5) guest GET page → sign-in redirect; guest POST endpoint → 401 JSON', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const guest = await playwrightRequest.newContext({
      baseURL: base,
      ignoreHTTPSErrors: true,
    });
    try {
      // GET render page without a session → redirected to platform sign-in (a
      // raw JSON 401 would break the page UX, slice-04 §5.1).
      const page = await guest.get(
        `${GRAPH_BASE}/${graph.knowledgeBaseProjectionId}`,
        { maxRedirects: 0 }
      );
      expect([302, 307]).toContain(page.status());
      const location = page.headers()['location'] ?? '';
      expect(location.length).toBeGreaterThan(0);

      // POST fan-out endpoint without a session → clean 401 JSON (slice-03
      // behavior preserved, not broken by the page redirect).
      const endpoint = await guest.post(`${GRAPH_BASE}/reconcile`, {
        data: { nodeId: 'knr_does_not_matter' },
        maxRedirects: 0,
      });
      expect(endpoint.status()).toBe(401);
    } finally {
      await guest.dispose();
    }
  });
});
