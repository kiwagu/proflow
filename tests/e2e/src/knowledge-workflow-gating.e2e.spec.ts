/**
 * Workflow + gating-registry acceptance test — slice 06
 * (docs/knowledge-graph-plan.md §5, refs §9).
 *
 * Proves the THIRD vertical (document review) lands as PURE CONFIGURATION over
 * the SAME graph: a `board` view_types row + document nodes carrying distinct
 * statuses and `workflow_key='document_review'` + a board `projections` row that
 * DECLARES the `requires_state` gating rule — ZERO new tables, ZERO engine /
 * resolver fork. The gating layer is now a REGISTRY (`sequence` + `requires_state`).
 *
 * Carrying boundary "authorization ≠ gating" (ADR-0006 §1 vs §2): RLS lets a
 * reader READ every document (they all stay in the result), while `requires_state`
 * marks non-approved docs `available=false` as DISPLAY state only. A reader
 * WITHOUT `space.knowledge.read` sees no documents at all (RLS, the sole hard
 * authority) — the contrast with gating.
 *
 * The generic `validateTransition` rejects an illegal transition by DATA (no
 * `draft→archived` edge in `document_review`) → 422; a legal `draft→in_review`
 * → 200; the per-transition `approve` guard splits actors: an `admin` actor
 * approves, an `author` actor (transition but not approve) is guard-denied.
 *
 * Demo nodes/projections live in the harness, never a migration (the lesson from
 * identity-sync). All writes go through the REAL `/author/graph/transition`
 * endpoint under the actor's Supabase session, and the REAL
 * `/author/graph/[projectionId]` page renders the gated board.
 *
 * Tagged `@full` — needs the running author app + Supabase.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  bootstrapWorkflowActors,
  seedWorkflowGatingDemo,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
  type WorkflowActors,
  type WorkflowGatingGraph,
} from './helpers/knowledge-graph-bootstrap.js';

const GRAPH_BASE = '/author/graph';
const ACTIVE_SPACE_COOKIE = 'pf_active_space_id';

// Match the rendered badge text node exactly (`>Not available</`) so the count is
// one-per-visible-gated-card, not also counting the RSC flight key references.
const NOT_AVAILABLE = '>not available</';

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

/** Count how many "not available" badges appear in the rendered board HTML. */
function notAvailableCount(html: string): number {
  return html.toLowerCase().split(NOT_AVAILABLE).length - 1;
}

test.describe('knowledge workflow + gating registry (board / requires_state) @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let graph: WorkflowGatingGraph;
  let workflowActors: WorkflowActors;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    graph = await seedWorkflowGatingDemo(tenant);
    workflowActors = await bootstrapWorkflowActors(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        workflowActors?.extraUserIds ?? []
      );
    }
  });

  test('(1) third vertical = pure configuration: board renders all docs over the same graph', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const res = await http.get(`${GRAPH_BASE}/${graph.boardProjectionId}`);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // All three documents render (RLS let them all be read) — the board is just
      // another projection over the same graph, added as data (no engine fork).
      expect(html).toContain(graph.draftTitle);
      expect(html).toContain(graph.inReviewTitle);
      expect(html).toContain(graph.approvedTitle);
    } finally {
      await http.dispose();
    }
  });

  test('(2) requires_state gates as DISPLAY: draft/in_review present but not available, approved available', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const res = await http.get(`${GRAPH_BASE}/${graph.boardProjectionId}`);
      expect(res.status(), await res.text()).toBe(200);
      const html = await res.text();

      // The gated nodes (draft + in_review) STAY in the board with a
      // "not available" badge — closure ≠ absence (ADR-0006 §2). The approved
      // node carries no such badge → exactly two not-available badges.
      expect(html).toContain(graph.draftTitle);
      expect(html).toContain(graph.inReviewTitle);
      expect(notAvailableCount(html)).toBe(2);
    } finally {
      await http.dispose();
    }
  });

  test('(3) illegal transition draft→archived → 422, status unchanged', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    const http = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const post = await http.post(`${GRAPH_BASE}/transition`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.draftDocId,
          toStatus: 'archived', // no draft→archived edge in document_review
        },
      });
      expect(post.status()).toBe(422);
    } finally {
      await http.dispose();
    }

    // The generic validator rejected it BEFORE any write — status is still draft.
    const { data: row, error } = await tenant.service
      .from('knowledge_resources')
      .select('status')
      .eq('id', graph.draftDocId)
      .single();
    expect(error).toBeNull();
    expect(row?.status).toBe('draft');
  });

  test('(4) legal draft→in_review → 200; in_review→approved guard-splits by verb', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';

    // ── legal, unguarded transition: draft → in_review (admin actor) ──────────
    const httpAdmin = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const post = await httpAdmin.post(`${GRAPH_BASE}/transition`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.draftDocId,
          toStatus: 'in_review',
        },
      });
      expect(post.status(), await post.text()).toBe(200);
    } finally {
      await httpAdmin.dispose();
    }

    const { data: afterSubmit } = await tenant.service
      .from('knowledge_resources')
      .select('status')
      .eq('id', graph.draftDocId)
      .single();
    expect(afterSubmit?.status).toBe('in_review');

    // ── guarded transition in_review → approved: author lacks `approve` ───────
    const httpAuthor = await actorHttp(
      workflowActors.transitioner,
      tenant.spaceId,
      base
    );
    try {
      const denied = await httpAuthor.post(`${GRAPH_BASE}/transition`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.inReviewDocId,
          toStatus: 'approved',
        },
      });
      // Per-transition guard `space.knowledge.approve` denies the author actor.
      expect(denied.status()).toBe(422);
      expect((await denied.text()).toLowerCase()).toContain('guard');
    } finally {
      await httpAuthor.dispose();
    }

    // Status unchanged after the denied approve.
    const { data: stillReview } = await tenant.service
      .from('knowledge_resources')
      .select('status')
      .eq('id', graph.inReviewDocId)
      .single();
    expect(stillReview?.status).toBe('in_review');

    // ── admin holds `approve` → the guarded transition succeeds ───────────────
    const httpAdmin2 = await actorHttp(tenant.granted, tenant.spaceId, base);
    try {
      const ok = await httpAdmin2.post(`${GRAPH_BASE}/transition`, {
        data: {
          spaceId: tenant.spaceId,
          resourceId: graph.inReviewDocId,
          toStatus: 'approved',
        },
      });
      expect(ok.status(), await ok.text()).toBe(200);

      // The newly-approved doc now becomes `available` in the board → one fewer
      // not-available badge (only the original draft remains gated).
      const board = await httpAdmin2.get(
        `${GRAPH_BASE}/${graph.boardProjectionId}`
      );
      const html = await board.text();
      expect(notAvailableCount(html)).toBe(1);
    } finally {
      await httpAdmin2.dispose();
    }

    const { data: approved } = await tenant.service
      .from('knowledge_resources')
      .select('status')
      .eq('id', graph.inReviewDocId)
      .single();
    expect(approved?.status).toBe('approved');
  });

  test('(5) RLS is the only hard authority: no read → no documents at all', async ({
    baseURL,
  }) => {
    const base = baseURL ?? 'https://proflow.local';
    // The `ungranted` actor (space_admin only, no space.knowledge.read) sees an
    // empty board — contrast with gating, where the node IS present but
    // available=false. Access is RLS; gating is display.
    const http = await actorHttp(tenant.ungranted, tenant.spaceId, base);
    try {
      const res = await http.get(`${GRAPH_BASE}/${graph.boardProjectionId}`);
      const html = await res.text();
      expect(html).not.toContain(graph.draftTitle);
      expect(html).not.toContain(graph.inReviewTitle);
      expect(html).not.toContain(graph.approvedTitle);
    } finally {
      await http.dispose();
    }
  });
});
