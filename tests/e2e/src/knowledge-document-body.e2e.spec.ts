/**
 * Document-body read-path acceptance — the regression net for increment A (the
 * `kind=text` node↔body bridge on `/author/graph/text-resources`). Three tests
 * chosen to catch the most likely failures of the cross-store fan-out:
 *
 *  1. ROUND-TRIP (the headline): a granted actor creates a text document with a
 *     real Lexical body → the node is bridged (`body_ref` set) AND reading it back
 *     returns the SAME body. This proves the whole seam end-to-end: Postgres node
 *     under RLS ↔ Payload/Mongo body, written inline and read by `node_id`.
 *  2. EMPTY-BUT-LIVE: a create with NO body still produces a real, readable (empty)
 *     body and a bridged node — the read-path is live before the editor exists, no
 *     mock.
 *  3. RLS BOUNDARY: an ungranted actor cannot create a document (nothing persists),
 *     and a granted document's body is HIDDEN from the ungranted actor on read
 *     (404) — body access is subordinate to node access (ADR-0002 §2).
 *
 * Driven over HTTP as the bootstrapped actors (runtime tenant, never a migration
 * seed). Tagged `@full` — needs the running stack (Next author app + Payload/Mongo).
 */
import {
  expect,
  request,
  test,
  type APIRequestContext,
} from '@playwright/test';

import {
  actorSsrAuthCookies,
  bootstrapKnowledgeGraphTenant,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

/** An HTTP context carrying an actor's SSR auth cookies. */
async function apiFor(actor: KnowledgeActor): Promise<APIRequestContext> {
  const cookies = await actorSsrAuthCookies(actor);
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return request.newContext({
    baseURL: BASE,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { cookie },
  });
}

/** A minimal Lexical body holding a single paragraph of `text`. */
function lexicalWithText(text: string) {
  return {
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
              detail: 0,
              format: 0,
              mode: 'normal',
              style: '',
              text,
              version: 1,
            },
          ],
        },
      ],
    },
  };
}

type CreateResult = {
  node_id: string;
  body_ref: { collection: string; doc_id: string };
};

async function createTextDoc(
  api: APIRequestContext,
  spaceId: string,
  title: string,
  lexicalBody?: unknown
): Promise<CreateResult> {
  const res = await api.post('/author/graph/text-resources', {
    data: { spaceId, title, ...(lexicalBody ? { lexicalBody } : {}) },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as CreateResult;
}

test.describe('@full knowledge document body', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('create → body bridged → read round-trips the Lexical body', async () => {
    const api = await apiFor(tenant.granted);

    const marker = `Hello from the body ${Date.now()}`;
    const created = await createTextDoc(
      api,
      tenant.spaceId,
      'Round-trip Doc',
      lexicalWithText(marker)
    );

    // The fan-out bridged the node to a Payload `bodies` doc.
    expect(created.body_ref.collection).toBe('bodies');
    expect(created.body_ref.doc_id.length).toBeGreaterThan(0);

    // The node row carries the same body_ref (service-role reads the truth).
    const { data: row } = await tenant.service
      .from('knowledge_resources')
      .select('body_ref,kind')
      .eq('id', created.node_id)
      .single();
    expect((row as { kind: string }).kind).toBe('text');
    expect(
      (row as { body_ref: { collection: string; doc_id: string } }).body_ref
    ).toEqual(created.body_ref);

    // Reading the body back returns the SAME content (cross-store round-trip).
    const readRes = await api.get(
      `/author/graph/text-resources?node_id=${created.node_id}&space_id=${tenant.spaceId}`
    );
    expect(readRes.status()).toBe(200);
    const read = (await readRes.json()) as { node_id: string; body: unknown };
    expect(read.node_id).toBe(created.node_id);
    expect(JSON.stringify(read.body)).toContain(marker);

    await api.dispose();
  });

  test('empty-but-live: create without a body → readable empty body, node bridged', async () => {
    const api = await apiFor(tenant.granted);

    const created = await createTextDoc(api, tenant.spaceId, 'Empty Doc');
    expect(created.body_ref.collection).toBe('bodies');
    expect(created.body_ref.doc_id.length).toBeGreaterThan(0);

    const readRes = await api.get(
      `/author/graph/text-resources?node_id=${created.node_id}&space_id=${tenant.spaceId}`
    );
    expect(readRes.status()).toBe(200);
    const read = (await readRes.json()) as {
      body: { root?: { children?: unknown[] } } | null;
    };
    // A real but empty Lexical body — present (not null), with a root and no text.
    expect(read.body).not.toBeNull();
    expect(read.body?.root).toBeDefined();
    expect(JSON.stringify(read.body)).not.toContain('"type":"text"');

    await api.dispose();
  });

  test('RLS: ungranted cannot create; a document body is hidden from the ungranted actor', async () => {
    const granted = await apiFor(tenant.granted);
    const ungranted = await apiFor(tenant.ungranted);

    // The ungranted actor (no space.knowledge.create) is rejected at the row policy.
    const forbidden = await ungranted.post('/author/graph/text-resources', {
      data: { spaceId: tenant.spaceId, title: 'Forbidden Doc' },
    });
    expect(forbidden.status()).toBe(422);

    // …and nothing was written (service-role bypasses RLS to check the truth).
    const { data: forbiddenRows } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .eq('title', 'Forbidden Doc');
    expect(forbiddenRows ?? []).toHaveLength(0);

    // A granted document's body is hidden from the ungranted actor on read: body
    // access is gated by node access, which RLS denies → 404 (ADR-0002 §2).
    const doc = await createTextDoc(granted, tenant.spaceId, 'Private Doc');
    const readRes = await ungranted.get(
      `/author/graph/text-resources?node_id=${doc.node_id}&space_id=${tenant.spaceId}`
    );
    expect(readRes.status()).toBe(404);

    await granted.dispose();
    await ungranted.dispose();
  });

  test('PATCH self-heals a bodyless text node: mints + bridges a body, then saves content', async () => {
    const api = await apiFor(tenant.granted);

    // A text node created directly with NO body (e.g. pre-dating the body
    // fan-out, or sample data) — still under the granted actor's RLS.
    const { data: bare, error } = await tenant.granted.client
      .from('knowledge_resources')
      .insert({
        space_id: tenant.spaceId,
        kind: 'text',
        title: 'Bodyless Doc',
        status: 'active',
        created_by: tenant.granted.userId,
        owner_user_id: tenant.granted.userId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const nodeId = (bare as { id: string }).id;

    // Saving self-heals (`ensureNodeBody` mints + bridges a body) then writes it.
    const marker = `Healed content ${Date.now()}`;
    const patch = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId,
        body: lexicalWithText(marker),
        status: 'draft',
      },
    });
    expect(patch.status()).toBe(200);

    // The node is now bridged to a freshly-minted body (service reads the truth).
    const { data: row } = await tenant.service
      .from('knowledge_resources')
      .select('body_ref')
      .eq('id', nodeId)
      .single();
    const ref = (
      row as { body_ref: { collection: string; doc_id: string } | null }
    ).body_ref;
    expect(ref?.collection).toBe('bodies');
    expect((ref?.doc_id ?? '').length).toBeGreaterThan(0);

    // …and the read reflects the saved content.
    const read = (await (
      await api.get(
        `/author/graph/text-resources?node_id=${nodeId}&space_id=${tenant.spaceId}`
      )
    ).json()) as { body: unknown };
    expect(JSON.stringify(read.body)).toContain(marker);

    await api.dispose();
  });

  test('PATCH saves a draft then publishes; read reflects content + _status; ungranted cannot save', async () => {
    const api = await apiFor(tenant.granted);
    const doc = await createTextDoc(api, tenant.spaceId, 'Editable Body Doc');
    const url = `/author/graph/text-resources?node_id=${doc.node_id}&space_id=${tenant.spaceId}`;
    const marker = `Edited content ${Date.now()}`;

    // Save as DRAFT — Payload `update` writes a draft version.
    const draftRes = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText(marker),
        status: 'draft',
      },
    });
    expect(draftRes.status()).toBe(200);

    // The author surface reads the LATEST → sees the draft content + status.
    const draftRead = (await (await api.get(url)).json()) as {
      body: unknown;
      status: string | null;
    };
    expect(draftRead.status).toBe('draft');
    expect(JSON.stringify(draftRead.body)).toContain(marker);

    // PUBLISH — promotes to `_status: published`.
    const pubRes = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText(marker),
        status: 'published',
      },
    });
    expect(pubRes.status()).toBe(200);

    const pubRead = (await (await api.get(url)).json()) as {
      body: unknown;
      status: string | null;
    };
    expect(pubRead.status).toBe('published');
    expect(JSON.stringify(pubRead.body)).toContain(marker);

    // RLS: an ungranted actor cannot save (node not visible → gate 404).
    const ungranted = await apiFor(tenant.ungranted);
    const denied = await ungranted.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('should not persist'),
        status: 'published',
      },
    });
    expect(denied.status()).toBe(404);

    await api.dispose();
    await ungranted.dispose();
  });
});
