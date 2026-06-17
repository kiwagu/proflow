/**
 * Async body-bridge consumer acceptance test — slice 08
 * (docs/knowledge-graph-plan.md §8). Proves the durable, eventually-consistent
 * half of the node↔body bridge: when the synchronous fan-out (slice-03) dies
 * mid-way, a background consumer claims an OPEN `body.linked` outbox row,
 * validates the envelope, and reconciles the node↔body link — or DLQs an invalid
 * envelope without ever touching the data.
 *
 * The consumer (`apps/author … body-bridge.outbox-worker.ts`) is the SECOND
 * consumer of the universal outbox (channel='operation'), a mirror of the
 * notifications worker. Its drain runs inside the author runtime (Payload Local
 * API), so this suite drives it DETERMINISTICALLY over HTTP via
 * `/author/graph/body-bridge/drain` — exactly as the slice-03 saga test drives
 * `/author/graph/reconcile`, never waiting on the poll timer.
 *
 * The four acceptance points (§6):
 *  1. Happy path → sync closed the row; the drain is a no-op (body_ref stays, no
 *     duplicate body).
 *  2. Sync failure injected between fan-out step 3 and 4 (body created, body_ref
 *     NOT set, a `body.linked` row left OPEN) → drain heals body_ref. Mirror
 *     branch: node deleted → drain removes the orphan body under service-role.
 *  3. Invalid envelope (service-role insert bypassing the enqueue seam) → safeParse
 *     fails → DLQ; reconcile is NEVER called (body/node untouched).
 *  4. Re-processing the same node → no-op (idempotent by node_id).
 *
 * Failure injection lives IN THE TEST (service-role manipulation in the harness),
 * never in production code. A genuinely-OPEN, claimable row is modeled by inserting
 * a fresh `body.linked` outbox row under service-role: the insert trigger enqueues
 * a pgmq message, so the consumer claims it on the next drain — faithful to a sync
 * crash that wrote the durable row but never closed it. Demo data is created at
 * runtime and torn down — never migration-seeded (the identity-sync lesson).
 *
 * Tagged `@full` — needs the running author app + Mongo (E2E_AUTHOR_MONGO_URL).
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  connectPayloadMongo,
  mongoDatabaseNameFromUri,
} from './helpers/payload-mongo-user.js';
import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const GRAPH_BASE = '/author/graph';

function mongoUrl(): string | undefined {
  return process.env.E2E_AUTHOR_MONGO_URL?.trim() || undefined;
}

const EMPTY_LEXICAL = {
  root: {
    type: 'root',
    children: [],
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
  },
} as const;

/** Playwright APIRequestContext carrying an actor's @supabase/ssr auth cookies. */
async function actorHttp(actor: KnowledgeActor, baseURL: string) {
  const cookies = await actorSsrAuthCookies(actor);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Cookie: cookieHeader },
  });
}

type FanoutResult = {
  node_id: string;
  body_ref: { collection: string; doc_id: string };
};

test.describe('knowledge async body-bridge consumer (durable reconcile) @full', () => {
  test.describe.configure({ timeout: 120_000 });

  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
  });

  test('drain heals OPEN rows, DLQs invalid envelopes, and is idempotent', async ({
    baseURL,
  }) => {
    test.skip(
      !mongoUrl(),
      'Set E2E_AUTHOR_MONGO_URL to assert the Payload body docs.'
    );
    const mongo = mongoUrl() as string;
    const base = baseURL ?? 'https://proflow.local';

    const grantedHttp = await actorHttp(tenant.granted, base);
    const mongoClient = await connectPayloadMongo(mongo);
    const dbName = mongoDatabaseNameFromUri(mongo);
    const bodies = mongoClient.db(dbName).collection('bodies');
    const service = tenant.service;

    /** Deterministic single pass of the async consumer (over HTTP). */
    const drain = async () => {
      const res = await grantedHttp.post(`${GRAPH_BASE}/body-bridge/drain`, {
        data: { spaceId: tenant.spaceId },
      });
      expect(res.status(), await res.text()).toBe(200);
    };

    /**
     * Inject an OPEN, claimable `body.linked` row for a node under service-role —
     * the insert trigger enqueues a pgmq message, so the consumer claims it on the
     * next drain. Models a sync crash that wrote the durable row but never closed
     * it. Returns the new row id.
     */
    const injectOpenLinkedRow = async (
      nodeId: string,
      bodyDocId: string
    ): Promise<string> => {
      const envelope = {
        schema_version: 1,
        event: 'body.linked',
        space_id: tenant.spaceId,
        node_id: nodeId,
        body_ref: { collection: 'bodies', doc_id: bodyDocId },
      };
      const { data, error } = await service
        .from('outbox_jobs')
        .insert({
          aggregate_type: 'knowledge_body',
          aggregate_id: nodeId,
          event_name: 'body.linked',
          channel: 'operation',
          operation_key: 'body-bridge',
          payload: envelope,
          idempotency_key: `body-bridge:open:${nodeId}:${Date.now()}:${Math.random()}`,
        })
        .select('id')
        .single();
      expect(error, `inject open row: ${error?.message ?? ''}`).toBeNull();
      return data?.id as string;
    };

    const rowStatus = async (rowId: string): Promise<string | undefined> => {
      const { data } = await service
        .from('outbox_jobs')
        .select('status')
        .eq('id', rowId)
        .maybeSingle();
      return data?.status;
    };

    try {
      // ── (1) Happy path → sync closed the row; drain is a no-op ───────────────
      const r1 = await grantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Consumer Happy Path',
          lexicalBody: EMPTY_LEXICAL,
        },
      });
      expect(r1.status(), await r1.text()).toBe(201);
      const happy = (await r1.json()) as FanoutResult;

      // Sync fan-out already linked body_ref (the consumer is a safety net only).
      const { data: happyNode } = await service
        .from('knowledge_resources')
        .select('body_ref')
        .eq('id', happy.node_id)
        .single();
      const happyRef = happyNode?.body_ref as { doc_id?: string } | null;
      expect(happyRef?.doc_id).toBe(happy.body_ref.doc_id);

      await drain();

      // body_ref still bound; exactly one body; the drain spawned no duplicate.
      expect(await bodies.countDocuments({ node_id: happy.node_id })).toBe(1);
      const { data: happyAfter } = await service
        .from('knowledge_resources')
        .select('body_ref')
        .eq('id', happy.node_id)
        .single();
      const happyRefAfter = happyAfter?.body_ref as { doc_id?: string } | null;
      expect(happyRefAfter?.doc_id).toBe(happy.body_ref.doc_id);

      // ── (2) Injected OPEN row → drain heals a missing body_ref ───────────────
      const r2 = await grantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Consumer Heal Path',
          lexicalBody: EMPTY_LEXICAL,
        },
      });
      expect(r2.status(), await r2.text()).toBe(201);
      const heal = (await r2.json()) as FanoutResult;

      // Crash injection (service-role, in-test): drop body_ref, then write a fresh
      // OPEN body.linked row the consumer will claim.
      const { error: nullErr } = await service
        .from('knowledge_resources')
        .update({ body_ref: null })
        .eq('id', heal.node_id);
      expect(nullErr).toBeNull();
      const healRowId = await injectOpenLinkedRow(
        heal.node_id,
        heal.body_ref.doc_id
      );

      await drain();

      // body_ref healed by node_id; the injected row completed.
      const { data: healed } = await service
        .from('knowledge_resources')
        .select('body_ref')
        .eq('id', heal.node_id)
        .single();
      const healedRef = healed?.body_ref as { doc_id?: string } | null;
      expect(healedRef?.doc_id).toBe(heal.body_ref.doc_id);
      expect(await rowStatus(healRowId)).toBe('completed');

      // ── (4) Re-processing the same node → no-op (idempotent by node_id) ──────
      const reRowId = await injectOpenLinkedRow(
        heal.node_id,
        heal.body_ref.doc_id
      );
      await drain();
      expect(await bodies.countDocuments({ node_id: heal.node_id })).toBe(1);
      expect(await rowStatus(reRowId)).toBe('completed');
      const { data: healed2 } = await service
        .from('knowledge_resources')
        .select('body_ref')
        .eq('id', heal.node_id)
        .single();
      const healedRef2 = healed2?.body_ref as { doc_id?: string } | null;
      expect(healedRef2?.doc_id).toBe(heal.body_ref.doc_id);

      // ── (2b) Mirror branch: node deleted → drain removes the orphan body ─────
      const r3 = await grantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Consumer Orphan Path',
          lexicalBody: EMPTY_LEXICAL,
        },
      });
      expect(r3.status(), await r3.text()).toBe(201);
      const orphan = (await r3.json()) as FanoutResult;

      // Delete the node (authority gone), then deliver an OPEN body.linked row.
      await service
        .from('knowledge_resources')
        .delete()
        .eq('id', orphan.node_id);
      const orphanRowId = await injectOpenLinkedRow(
        orphan.node_id,
        orphan.body_ref.doc_id
      );

      await drain();

      const goneBody = await bodies.findOne({ node_id: orphan.node_id });
      expect(goneBody, 'orphan body removed by the consumer').toBeNull();
      expect(await rowStatus(orphanRowId)).toBe('completed');

      // ── (3) Invalid envelope → DLQ, reconcile NEVER called ───────────────────
      const r4 = await grantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Consumer Invalid Envelope',
          lexicalBody: EMPTY_LEXICAL,
        },
      });
      expect(r4.status(), await r4.text()).toBe(201);
      const valid = (await r4.json()) as FanoutResult;

      // Corrupt body-bridge row (service-role, bypassing the enqueue seam that
      // would reject it): missing node_id, wrong schema_version, no event.
      const { data: badRow, error: badErr } = await service
        .from('outbox_jobs')
        .insert({
          aggregate_type: 'knowledge_body',
          aggregate_id: `${valid.node_id}-corrupt`,
          event_name: 'body.linked',
          channel: 'operation',
          operation_key: 'body-bridge',
          payload: { schema_version: 99, garbage: true },
          idempotency_key: `body-bridge:corrupt:${valid.node_id}:${Date.now()}`,
        })
        .select('id')
        .single();
      expect(badErr).toBeNull();
      expect(badRow?.id).toBeTruthy();

      await drain();

      // The corrupt row is DLQ'd (status='failed'); the real body/node untouched.
      expect(await rowStatus(badRow?.id as string)).toBe('failed');
      const stillBody = await bodies.findOne({ node_id: valid.node_id });
      expect(
        stillBody,
        'valid body untouched by the invalid-envelope DLQ'
      ).not.toBeNull();
      const { data: stillNode } = await service
        .from('knowledge_resources')
        .select('id,body_ref')
        .eq('id', valid.node_id)
        .single();
      expect(stillNode?.id).toBe(valid.node_id);
      const stillRef = stillNode?.body_ref as { doc_id?: string } | null;
      expect(stillRef?.doc_id).toBe(valid.body_ref.doc_id);
    } finally {
      await mongoClient.close();
      await grantedHttp.dispose();
    }
  });
});
