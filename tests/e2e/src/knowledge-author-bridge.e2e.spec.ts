/**
 * Author bridge acceptance test — slice 03 (docs/knowledge-graph-plan.md §3).
 *
 * Proves the authoring half of ADR-0005 + the node↔body bridge of ADR-0002: ONE
 * author act = a `kind=text` node in Postgres (under RLS) + a Lexical body in
 * Payload/Mongo, linked two-ways, plus one explicit `prerequisite` edge, with
 * partial-failure reconciliation. Drives the REAL fan-out endpoint
 * (`/author/graph/text-resources`) over HTTP as the granted actor (Supabase
 * session → the endpoint's RLS client), then asserts Postgres (supabase-js) and
 * Payload (Mongo) directly. Demo data lives in the harness, never a migration.
 *
 * The three review-enforced disciplines this proves:
 *  A. `bodies` access reduces to a Postgres-RLS check by node_id (steps 6–7).
 *  B. the fan-out runs under the user's RLS client; RLS denial stops it at the
 *     authoritative first step (step 6) — the body never appears.
 *  C. fan-out/event/reconcile logic lives in the server application module; the
 *     test exercises it through our own endpoints (the view holds none of it).
 *
 * Tagged `@full` — needs the running author app + Mongo (E2E_AUTHOR_MONGO_URL).
 */
import {
  parseProjectionSpec,
  type ProjectionSpec,
} from '@workspace/knowledge-contracts';
import { resolveProjection } from '@workspace/knowledge-engine';
import { expect, request as playwrightRequest, test } from '@playwright/test';

import {
  connectPayloadMongo,
  mongoDatabaseNameFromUri,
} from './helpers/payload-mongo-user.js';
import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  buildKnowledgeBaseSpec,
  seedBodyBridgeFixture,
  teardownKnowledgeGraphTenant,
  type BodyBridgeFixture,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';
import {
  closeResolveTransportPool,
  transportForActor,
} from './helpers/projection-resolve-transport.js';

const GRAPH_BASE = '/author/graph';

function mongoUrl(): string | undefined {
  return process.env.E2E_AUTHOR_MONGO_URL?.trim() || undefined;
}

function kbSpec(tagNodeId: string): ProjectionSpec {
  const parsed = parseProjectionSpec(buildKnowledgeBaseSpec(tagNodeId));
  if (!parsed.success) throw new Error('kbSpec parse failed');
  return parsed.data;
}

/** Playwright APIRequestContext carrying an actor's @supabase/ssr auth cookies. */
async function actorHttp(actor: KnowledgeActor, baseURL: string) {
  const cookies = await actorSsrAuthCookies(actor);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const ctx = await playwrightRequest.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Cookie: cookieHeader },
  });
  return ctx;
}

test.describe('knowledge author bridge (node↔body fan-out) @full', () => {
  test.describe.configure({ timeout: 120_000 });

  let tenant: KnowledgeGraphTenant;
  let fixture: BodyBridgeFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fixture = await seedBodyBridgeFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(tenant);
    }
    await closeResolveTransportPool();
  });

  test('fan-out creates node + body + edge, two-way linked, RLS-enforced, projection resolves', async ({
    baseURL,
  }) => {
    test.skip(
      !mongoUrl(),
      'Set E2E_AUTHOR_MONGO_URL to assert the Payload body doc.'
    );
    const mongo = mongoUrl() as string;
    const base = baseURL ?? 'https://proflow.local';

    const grantedHttp = await actorHttp(tenant.granted, base);
    const mongoClient = await connectPayloadMongo(mongo);
    const dbName = mongoDatabaseNameFromUri(mongo);
    const bodies = mongoClient.db(dbName).collection('bodies');

    try {
      // ── act: ONE fan-out save as the granted actor ──────────────────────────
      const res = await grantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Fan-out Authored Lesson',
          lexicalBody: {
            root: {
              type: 'root',
              format: '',
              indent: 0,
              version: 1,
              direction: 'ltr',
              children: [
                {
                  type: 'paragraph',
                  format: '',
                  indent: 0,
                  version: 1,
                  direction: 'ltr',
                  textFormat: 0,
                  children: [
                    {
                      type: 'text',
                      mode: 'normal',
                      text: 'Authored via the fan-out endpoint.',
                      detail: 0,
                      format: 0,
                      style: '',
                      version: 1,
                    },
                  ],
                },
              ],
            },
          },
          edge: { relationType: 'prerequisite', toId: fixture.targetNodeId },
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      const out = (await res.json()) as {
        node_id: string;
        body_ref: { collection: string; doc_id: string };
        edge_id?: string;
      };
      expect(out.node_id).toMatch(/^knr_/);
      expect(out.body_ref.collection).toBe('bodies');
      expect(out.edge_id).toBeTruthy();

      // (1) node in Postgres: kind=text, created_by=granted.
      const { data: node } = await tenant.granted.client
        .from('knowledge_resources')
        .select('id,kind,created_by,space_id,body_ref')
        .eq('id', out.node_id)
        .single();
      expect(node?.kind).toBe('text');
      expect(node?.created_by).toBe(tenant.granted.userId);

      // (2) body doc in Payload/Mongo: node_id + space_id + Lexical body.
      const bodyDoc = await bodies.findOne({ node_id: out.node_id });
      expect(bodyDoc, 'body doc exists in Payload').not.toBeNull();
      expect(bodyDoc?.space_id).toBe(tenant.spaceId);
      expect(bodyDoc?.body).toBeTruthy();

      // (3) two-way link: node.body_ref ⇄ body.node_id, space matches.
      const nodeBodyRef = node?.body_ref as {
        collection?: string;
        doc_id?: string;
      } | null;
      expect(nodeBodyRef?.collection).toBe('bodies');
      expect(nodeBodyRef?.doc_id).toBe(out.body_ref.doc_id);
      expect(String(bodyDoc?._id)).toBe(out.body_ref.doc_id);
      expect(bodyDoc?.space_id).toBe(node?.space_id);

      // (4) edge prerequisite exists, same-space-guard passed.
      const { data: edge } = await tenant.granted.client
        .from('knowledge_edges')
        .select('id,from_id,to_id,relation_type,space_id')
        .eq('id', out.edge_id as string)
        .single();
      expect(edge?.relation_type).toBe('prerequisite');
      expect(edge?.from_id).toBe(out.node_id);
      expect(edge?.to_id).toBe(fixture.targetNodeId);
      expect(edge?.space_id).toBe(tenant.spaceId);

      // (5) projection resolves the new resource with a non-empty body_ref.
      // Tag the new node into the KB tag, then resolve the KB projection.
      const { error: tagEdgeErr } = await tenant.granted.client
        .from('knowledge_edges')
        .insert({
          space_id: tenant.spaceId,
          from_id: out.node_id,
          to_id: fixture.tagNodeId,
          relation_type: 'tagged',
          position: 0,
          created_by: tenant.granted.userId,
        });
      expect(tagEdgeErr).toBeNull();

      const projection = await resolveProjection(kbSpec(fixture.tagNodeId), {
        projectionId: fixture.knowledgeBaseProjectionId,
        spaceId: tenant.spaceId,
        db: tenant.granted.client,
        transport: await transportForActor(tenant.granted.client),
      });
      const resolved = projection.items.find((i) => i.id === out.node_id);
      expect(
        resolved,
        'new resource resolves in the KB projection'
      ).toBeTruthy();
      const resolvedBodyRef = resolved?.body_ref as {
        collection?: string;
        doc_id?: string;
      } | null;
      expect(resolvedBodyRef?.doc_id).toBe(out.body_ref.doc_id);

      // (6) RLS enforced: same fan-out under ungranted → node INSERT rejected,
      //     body NOT created.
      const ungrantedHttp = await actorHttp(tenant.ungranted, base);
      const denied = await ungrantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Should never persist',
          lexicalBody: {
            root: {
              type: 'root',
              children: [],
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
            },
          },
        },
      });
      expect(denied.status()).toBe(422);
      const deniedBodyCount = await bodies.countDocuments({
        space_id: tenant.spaceId,
        node_id: { $exists: true },
      });
      // No body was created for an ungranted attempt: only the one granted body
      // exists for this space.
      expect(deniedBodyCount).toBe(1);
      await ungrantedHttp.dispose();

      // (7) Payload access subordinate: ungranted cannot read the body doc via
      //     the Payload REST API (access reduces to RLS by node_id → empty).
      const ungrantedRead = await actorHttp(tenant.ungranted, base);
      const readRes = await ungrantedRead.get(
        `/author/api/bodies/${out.body_ref.doc_id}?depth=0`
      );
      // Subordinate access denies (403/404) — never returns the doc body.
      expect([401, 403, 404]).toContain(readRes.status());
      await ungrantedRead.dispose();
    } finally {
      await mongoClient.close();
      await grantedHttp.dispose();
    }
  });

  test('saga: reconcile heals a missing body_ref, and removes an orphan body', async ({
    baseURL,
  }) => {
    test.skip(
      !mongoUrl(),
      'Set E2E_AUTHOR_MONGO_URL to assert the Payload body doc.'
    );
    const mongo = mongoUrl() as string;
    const base = baseURL ?? 'https://proflow.local';

    const grantedHttp = await actorHttp(tenant.granted, base);
    const mongoClient = await connectPayloadMongo(mongo);
    const dbName = mongoDatabaseNameFromUri(mongo);
    const bodies = mongoClient.db(dbName).collection('bodies');

    try {
      // Author a fresh resource.
      const res = await grantedHttp.post(`${GRAPH_BASE}/text-resources`, {
        data: {
          spaceId: tenant.spaceId,
          title: 'Saga Lesson',
          lexicalBody: {
            root: {
              type: 'root',
              children: [],
              direction: 'ltr',
              format: '',
              indent: 0,
              version: 1,
            },
          },
        },
      });
      expect(res.status(), await res.text()).toBe(201);
      const out = (await res.json()) as {
        node_id: string;
        body_ref: { collection: string; doc_id: string };
      };

      // Simulate a crash between step 3 and 4: body exists, body_ref is null.
      const { error: nullErr } = await tenant.granted.client
        .from('knowledge_resources')
        .update({ body_ref: null })
        .eq('id', out.node_id);
      expect(nullErr).toBeNull();

      // Reconcile heals body_ref by node_id (idempotent).
      const heal = await grantedHttp.post(`${GRAPH_BASE}/reconcile`, {
        data: { nodeId: out.node_id },
      });
      expect(heal.status(), await heal.text()).toBe(200);
      const healResult = (await heal.json()) as { relinked: boolean };
      expect(healResult.relinked).toBe(true);

      const { data: healed } = await tenant.granted.client
        .from('knowledge_resources')
        .select('body_ref')
        .eq('id', out.node_id)
        .single();
      const healedRef = healed?.body_ref as { doc_id?: string } | null;
      expect(healedRef?.doc_id).toBe(out.body_ref.doc_id);

      // Idempotent: a second reconcile does not re-link.
      const heal2 = await grantedHttp.post(`${GRAPH_BASE}/reconcile`, {
        data: { nodeId: out.node_id },
      });
      const heal2Result = (await heal2.json()) as { relinked: boolean };
      expect(heal2Result.relinked).toBe(false);

      // Orphan path: delete the node (service-role), then reconcile → body.unlinked
      // removes the orphan Payload doc.
      await tenant.service
        .from('knowledge_resources')
        .delete()
        .eq('id', out.node_id);

      const orphan = await grantedHttp.post(`${GRAPH_BASE}/reconcile`, {
        data: { nodeId: out.node_id },
      });
      expect(orphan.status(), await orphan.text()).toBe(200);
      const orphanResult = (await orphan.json()) as { orphanRemoved: boolean };
      expect(orphanResult.orphanRemoved).toBe(true);

      const goneBody = await bodies.findOne({ node_id: out.node_id });
      expect(goneBody).toBeNull();
    } finally {
      await mongoClient.close();
      await grantedHttp.dispose();
    }
  });
});
