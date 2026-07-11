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
 *     (404) — body access is subordinate to node access.
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

/** A real but empty Lexical body — a root with no children (no text nodes). */
const EMPTY_LEXICAL = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [],
  },
} as const;

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

  test('create → body bridged → publish → read round-trips the Lexical body', async () => {
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

    // Read mode serves ONLY the published version; publish so the body is visible.
    const pub = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: created.node_id,
        body: lexicalWithText(marker),
        status: 'published',
      },
    });
    expect(pub.status()).toBe(200);

    // Reading the body back returns the SAME content (cross-store round-trip).
    const readRes = await api.get(
      `/author/graph/text-resources?node_id=${created.node_id}&space_id=${tenant.spaceId}`
    );
    expect(readRes.status()).toBe(200);
    const read = (await readRes.json()) as {
      node_id: string;
      body: unknown;
      published: boolean;
    };
    expect(read.node_id).toBe(created.node_id);
    expect(read.published).toBe(true);
    expect(JSON.stringify(read.body)).toContain(marker);

    await api.dispose();
  });

  test('read mode hides an unpublished document until it is published', async () => {
    const api = await apiFor(tenant.granted);

    const created = await createTextDoc(api, tenant.spaceId, 'Empty Doc');
    expect(created.body_ref.collection).toBe('bodies');
    expect(created.body_ref.doc_id.length).toBeGreaterThan(0);

    const readUrl = `/author/graph/text-resources?node_id=${created.node_id}&space_id=${tenant.spaceId}`;

    // Freshly created (never published) → read mode shows NOTHING: no published
    // version, so the draft is not surfaced (the moderation gate).
    const before = (await (await api.get(readUrl)).json()) as {
      body: unknown;
      status: string | null;
      published: boolean;
    };
    expect(before.published).toBe(false);
    expect(before.body).toBeNull();
    expect(before.status).toBeNull();

    // Publish the (empty) body → now read mode serves it: a real, empty Lexical
    // body (present, with a root and no text).
    const pub = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: created.node_id,
        body: EMPTY_LEXICAL,
        status: 'published',
      },
    });
    expect(pub.status()).toBe(200);

    const after = (await (await api.get(readUrl)).json()) as {
      body: { root?: { children?: unknown[] } } | null;
      published: boolean;
    };
    expect(after.published).toBe(true);
    expect(after.body).not.toBeNull();
    expect(after.body?.root).toBeDefined();
    expect(JSON.stringify(after.body)).not.toContain('"type":"text"');

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
    // access is gated by node access, which RLS denies → 404.
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
    // Publish so the content is visible in read mode (which serves published only).
    const marker = `Healed content ${Date.now()}`;
    const patch = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId,
        body: lexicalWithText(marker),
        status: 'published',
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

  test('read mode hides the draft, then shows it once published; ungranted cannot save', async () => {
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

    // Read mode serves ONLY the published version → a draft is NOT surfaced
    // (the moderation gate: a double-click never shows un-approved material).
    const draftRead = (await (await api.get(url)).json()) as {
      body: unknown;
      status: string | null;
      published: boolean;
    };
    expect(draftRead.published).toBe(false);
    expect(draftRead.body).toBeNull();
    expect(draftRead.status).toBeNull();

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

  test('versions: lists the body draft/publish history, RLS-gated', async () => {
    const api = await apiFor(tenant.granted);
    const doc = await createTextDoc(api, tenant.spaceId, 'Versioned Doc');
    const versionsUrl = `/author/graph/text-resources/versions?node_id=${doc.node_id}&space_id=${tenant.spaceId}`;

    // Each save records a version (draft, then published).
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('draft revision'),
        status: 'draft',
      },
    });
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('published revision'),
        status: 'published',
      },
    });

    const res = await api.get(versionsUrl);
    expect(res.status()).toBe(200);
    const { versions } = (await res.json()) as {
      versions: { id: string; status: string | null; updatedAt: string }[];
    };
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toHaveProperty('id');
    expect(versions[0]).toHaveProperty('updatedAt');
    // the workflow status is surfaced (a publish happened).
    expect(versions.map((v) => v.status)).toContain('published');

    // RLS: an ungranted actor cannot list versions (node not visible → 404).
    const ungranted = await apiFor(tenant.ungranted);
    const denied = await ungranted.get(versionsUrl);
    expect(denied.status()).toBe(404);

    await api.dispose();
    await ungranted.dispose();
  });

  test('versions: view a revision, restore it (becomes current), RLS-gated', async () => {
    const api = await apiFor(tenant.granted);
    const doc = await createTextDoc(api, tenant.spaceId, 'Restorable Doc');
    const versionsUrl = `/author/graph/text-resources/versions?node_id=${doc.node_id}&space_id=${tenant.spaceId}`;
    const readUrl = `/author/graph/text-resources?node_id=${doc.node_id}&space_id=${tenant.spaceId}`;

    const alpha = `Alpha ${Date.now()}`;
    const beta = `Beta ${Date.now()}`;
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText(alpha),
        status: 'published',
      },
    });
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText(beta),
        status: 'published',
      },
    });

    // Current body is beta; find the version that holds alpha (view-one).
    const { versions } = (await (await api.get(versionsUrl)).json()) as {
      versions: { id: string }[];
    };
    let alphaVersionId: string | null = null;
    for (const v of versions) {
      const viewed = (await (
        await api.get(`${versionsUrl}&version_id=${v.id}`)
      ).json()) as { body: unknown };
      if (JSON.stringify(viewed.body).includes(alpha)) {
        alphaVersionId = v.id;
        break;
      }
    }
    expect(alphaVersionId).not.toBeNull();

    // Restore the alpha revision → it becomes the current body.
    const restoreRes = await api.post('/author/graph/text-resources/versions', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        versionId: alphaVersionId,
        action: 'restore',
      },
    });
    expect(restoreRes.status()).toBe(200);

    const restored = (await (await api.get(readUrl)).json()) as {
      body: unknown;
    };
    expect(JSON.stringify(restored.body)).toContain(alpha);

    // RLS: an ungranted actor cannot view or restore (node not visible → 404).
    const ungranted = await apiFor(tenant.ungranted);
    const deniedView = await ungranted.get(
      `${versionsUrl}&version_id=${alphaVersionId}`
    );
    expect(deniedView.status()).toBe(404);
    const deniedRestore = await ungranted.post(
      '/author/graph/text-resources/versions',
      {
        data: {
          spaceId: tenant.spaceId,
          nodeId: doc.node_id,
          versionId: alphaVersionId,
          action: 'restore',
        },
      }
    );
    expect(deniedRestore.status()).toBe(404);

    await api.dispose();
    await ungranted.dispose();
  });

  test('versions: delete a DRAFT revision; a published one cannot be deleted, RLS-gated', async () => {
    const api = await apiFor(tenant.granted);
    const doc = await createTextDoc(api, tenant.spaceId, 'Prunable Doc');
    const versionsUrl = `/author/graph/text-resources/versions?node_id=${doc.node_id}&space_id=${tenant.spaceId}`;
    const del = (versionId: string, ctx = api) =>
      ctx.delete('/author/graph/text-resources/versions', {
        data: { spaceId: tenant.spaceId, nodeId: doc.node_id, versionId },
      });

    // Record a draft and a published version.
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('a draft to prune'),
        status: 'draft',
      },
    });
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('the published one'),
        status: 'published',
      },
    });

    const list = async () =>
      (
        (await (await api.get(versionsUrl)).json()) as {
          versions: { id: string; status: string | null }[];
        }
      ).versions;
    const before = await list();
    const draft = before.find((v) => v.status === 'draft');
    const published = before.find((v) => v.status === 'published');
    expect(draft).toBeDefined();
    expect(published).toBeDefined();

    // A published revision is immutable here → 422, still present.
    const deniedPublished = await del(published!.id);
    expect(deniedPublished.status()).toBe(422);

    // RLS: an ungranted actor cannot delete (node not visible → 404).
    const ungranted = await apiFor(tenant.ungranted);
    const deniedRls = await del(draft!.id, ungranted);
    expect(deniedRls.status()).toBe(404);

    // The draft revision is removed from history.
    const ok = await del(draft!.id);
    expect(ok.status()).toBe(200);
    const after = await list();
    expect(after.some((v) => v.id === draft!.id)).toBe(false);
    expect(after.some((v) => v.id === published!.id)).toBe(true);

    // Deleting the LATEST draft (the one flagged `latest`) must NOT orphan the
    // document: the body doc resolves from the main collection, so the list still
    // shows history and the doc stays editable. (Regression: it previously emptied
    // the version view and broke ensureNodeBody with a node_id conflict.)
    await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('newest draft'),
        status: 'draft',
      },
    });
    const withLatest = await list();
    const latestDraft = withLatest.find((v) => v.status === 'draft');
    expect(latestDraft).toBeDefined();
    expect((await del(latestDraft!.id)).status()).toBe(200);

    const afterLatest = await list();
    expect(afterLatest.length).toBeGreaterThan(0);
    expect(afterLatest.some((v) => v.status === 'published')).toBe(true);

    // Still editable — ensureNodeBody finds the existing body (no spurious create).
    const reSave = await api.patch('/author/graph/text-resources', {
      data: {
        spaceId: tenant.spaceId,
        nodeId: doc.node_id,
        body: lexicalWithText('after prune'),
        status: 'draft',
      },
    });
    expect(reSave.status()).toBe(200);

    await api.dispose();
    await ungranted.dispose();
  });

  test('unpublish: a draft save keeps it published, but Unpublish hides it; RLS-gated', async () => {
    const api = await apiFor(tenant.granted);
    const doc = await createTextDoc(api, tenant.spaceId, 'Unpublishable Doc');
    const readUrl = `/author/graph/text-resources?node_id=${doc.node_id}&space_id=${tenant.spaceId}`;
    const read = async () =>
      (await (await api.get(readUrl)).json()) as {
        body: unknown;
        published: boolean;
      };
    const patch = (data: Record<string, unknown>) =>
      api.patch('/author/graph/text-resources', {
        data: { spaceId: tenant.spaceId, nodeId: doc.node_id, ...data },
      });

    const pub = `Published ${Date.now()}`;
    expect(
      (
        await patch({ body: lexicalWithText(pub), status: 'published' })
      ).status()
    ).toBe(200);
    const published = await read();
    expect(published.published).toBe(true);
    expect(JSON.stringify(published.body)).toContain(pub);

    // A draft save on top must NOT unpublish — read still shows the PUBLISHED body.
    const wip = `Newer draft ${Date.now()}`;
    expect(
      (await patch({ body: lexicalWithText(wip), status: 'draft' })).status()
    ).toBe(200);
    const stillPublished = await read();
    expect(stillPublished.published).toBe(true);
    expect(JSON.stringify(stillPublished.body)).toContain(pub);
    expect(JSON.stringify(stillPublished.body)).not.toContain(wip);

    // Unpublish (status-only, no body) → read mode hides it.
    expect((await patch({ status: 'draft' })).status()).toBe(200);
    const unpublished = await read();
    expect(unpublished.published).toBe(false);
    expect(unpublished.body).toBeNull();

    // RLS: an ungranted actor cannot unpublish (node not visible → 404).
    const ungranted = await apiFor(tenant.ungranted);
    const denied = await ungranted.patch('/author/graph/text-resources', {
      data: { spaceId: tenant.spaceId, nodeId: doc.node_id, status: 'draft' },
    });
    expect(denied.status()).toBe(404);

    await api.dispose();
    await ungranted.dispose();
  });
});
