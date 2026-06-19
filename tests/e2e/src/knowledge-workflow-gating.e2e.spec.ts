/**
 * Status-transition authoring acceptance test — slice 06 substrate, kept under the
 * single-lens-editor concept (slice-09 rev. 3, ADR-0012 §3).
 *
 * The `board` view + its `requires_state` DISPLAY render were RETIRED from the
 * product (ADR-0012 §2); this spec therefore no longer renders a board. The
 * `validateTransition` workflow validator stays as DORMANT substrate (engine-unit
 * covered by `workflow.validator.test.ts` / `gating-registry.test.ts`), and the
 * `/author/graph/transition` endpoint REMAINS a live AUTHORING action of the lens
 * editor (status-transition, §3.6 / §7). This spec keeps exactly that surface:
 *
 *  (1) the generic validator rejects an illegal transition by DATA (no
 *      `draft→archived` edge in `document_review`) → 422, status unchanged.
 *  (2) a legal `draft→in_review` → 200; the per-transition `approve` guard splits
 *      actors: an `author` actor (transition but not approve) is guard-denied, an
 *      `admin` actor (holds `approve`) succeeds — all enforced at the row by RLS.
 *
 * Demo nodes live in the harness, never a migration. Writes go through the REAL
 * `/author/graph/transition` endpoint under each actor's Supabase session.
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

test.describe('knowledge status-transition authoring (validateTransition) @full', () => {
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

  test('(1) illegal transition draft→archived → 422, status unchanged', async ({
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

  test('(2) legal draft→in_review → 200; in_review→approved guard-splits by verb', async ({
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
});
