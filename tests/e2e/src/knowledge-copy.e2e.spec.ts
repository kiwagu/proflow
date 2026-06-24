/**
 * Deep-copy acceptance — the regression net for `POST /author/graph/copy` (the
 * `copyResourceSubtree` fan-out). Two tests chosen to catch the highest-risk
 * failures:
 *
 *  1. DEEP INTEGRITY: copying a folder duplicates its whole `contains` subtree —
 *     a new owner-pinned, PRIVATE clone of every node, the structure preserved,
 *     and each text node's body cloned to an INDEPENDENT `bodies` doc (the
 *     `body_ref` differs from the source). The source is untouched.
 *  2. FAIL-CLOSED (ADR-0017): a member copying someone else's SPACE-shared tree
 *     gets their OWN PRIVATE drafts — the source's audience is never re-broadcast.
 *     This is the security-critical property of copy, so it gets its own test.
 *
 * Driven over HTTP as bootstrapped actors (runtime tenant, never a migration seed —
 * the identity-sync lesson). Tagged `@full` — needs the running stack. Truth is read
 * back with service-role (bypasses RLS) — the body lives in Payload, but the
 * `body_ref` bridge is in Postgres, so body cloning is provable here without Mongo.
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
  bootstrapMemberActor,
  teardownKnowledgeGraphTenant,
  type KnowledgeActor,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://proflow.local';

async function apiFor(actor: KnowledgeActor): Promise<APIRequestContext> {
  const cookies = await actorSsrAuthCookies(actor);
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return request.newContext({
    baseURL: BASE,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { cookie },
  });
}

async function createFolder(
  api: APIRequestContext,
  spaceId: string,
  title: string,
  parentFolderId?: string
): Promise<string> {
  const res = await api.post('/author/graph/resources', {
    data: {
      spaceId,
      kind: 'folder',
      title,
      ...(parentFolderId ? { parentFolder: { parentFolderId } } : {}),
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { node_id: string }).node_id;
}

async function createDoc(
  api: APIRequestContext,
  spaceId: string,
  title: string,
  parentFolderId: string
): Promise<string> {
  const res = await api.post('/author/graph/text-resources', {
    data: { spaceId, title, parentFolder: { parentFolderId } },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { node_id: string }).node_id;
}

/** The single `contains` child of a node (the deep-copy tree is a strict chain here). */
async function onlyChild(
  tenant: KnowledgeGraphTenant,
  fromId: string
): Promise<string> {
  const { data } = await tenant.service
    .from('knowledge_edges')
    .select('to_id')
    .eq('from_id', fromId)
    .eq('relation_type', 'contains');
  const edges = (data ?? []) as { to_id: string }[];
  expect(edges).toHaveLength(1);
  return edges[0]!.to_id;
}

type ResourceRow = {
  kind: string;
  title: string;
  owner_user_id: string;
  visibility: string;
  body_ref: { collection: string; doc_id: string } | null;
};

async function resource(
  tenant: KnowledgeGraphTenant,
  id: string
): Promise<ResourceRow> {
  const { data } = await tenant.service
    .from('knowledge_resources')
    .select('kind,title,owner_user_id,visibility,body_ref')
    .eq('id', id)
    .single();
  return data as ResourceRow;
}

async function setFloor(
  api: APIRequestContext,
  resourceId: string,
  visibility: 'private' | 'space' | 'organization'
): Promise<void> {
  const res = await api.patch('/author/graph/visibility', {
    data: { resourceId, visibility },
  });
  expect(res.status()).toBe(200);
}

test.describe('@full knowledge deep-copy', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('deep: duplicates the contains subtree + clones each body, source untouched', async () => {
    const api = await apiFor(tenant.granted);

    // Root → Child → Doc (a text node, born with an empty-but-live body).
    const root = await createFolder(api, tenant.spaceId, 'Root');
    const child = await createFolder(api, tenant.spaceId, 'Child', root);
    const doc = await createDoc(api, tenant.spaceId, 'Doc', child);
    const srcDoc = await resource(tenant, doc);
    expect(srcDoc.body_ref?.doc_id).toBeTruthy();

    // Copy the whole Root to the top level (the UI builds the "(copy)" suffix and
    // passes it as rootTitle; the route itself stays suffix-agnostic).
    const res = await api.post('/author/graph/copy', {
      data: {
        spaceId: tenant.spaceId,
        sourceId: root,
        targetFolderId: null,
        rootTitle: 'Root (copy)',
      },
    });
    expect(res.status()).toBe(201);
    const copied = (await res.json()) as { node_id: string; count: number };
    expect(copied.count).toBe(3); // root + child + doc

    // The new root: owner-pinned, PRIVATE, "(copy)" title — a distinct node.
    expect(copied.node_id).not.toBe(root);
    const newRoot = await resource(tenant, copied.node_id);
    expect(newRoot).toMatchObject({
      kind: 'folder',
      title: 'Root (copy)',
      owner_user_id: tenant.granted.userId,
      visibility: 'private',
    });

    // Structure preserved: newRoot → newChild → newDoc, all fresh + private.
    const newChild = await onlyChild(tenant, copied.node_id);
    expect(newChild).not.toBe(child);
    expect(await resource(tenant, newChild)).toMatchObject({
      kind: 'folder',
      title: 'Child',
      owner_user_id: tenant.granted.userId,
      visibility: 'private',
    });

    const newDoc = await onlyChild(tenant, newChild);
    expect(newDoc).not.toBe(doc);
    const copiedDoc = await resource(tenant, newDoc);
    expect(copiedDoc).toMatchObject({
      kind: 'text',
      title: 'Doc',
      owner_user_id: tenant.granted.userId,
      visibility: 'private',
    });

    // Body CLONED to an independent doc — not aliased to the source body.
    expect(copiedDoc.body_ref?.doc_id).toBeTruthy();
    expect(copiedDoc.body_ref?.doc_id).not.toBe(srcDoc.body_ref?.doc_id);

    // Source is untouched (title + its original body bridge).
    const srcRootAfter = await resource(tenant, root);
    expect(srcRootAfter.title).toBe('Root');
    const srcDocAfter = await resource(tenant, doc);
    expect(srcDocAfter.body_ref?.doc_id).toBe(srcDoc.body_ref?.doc_id);

    await api.dispose();
  });

  test('fail-closed: a member copying a SPACE-shared tree gets private own drafts', async () => {
    const ownerApi = await apiFor(tenant.granted);

    // granted publishes a folder + doc to the whole space (owner-sovereign floor).
    const folder = await createFolder(ownerApi, tenant.spaceId, 'Shared');
    const note = await createDoc(ownerApi, tenant.spaceId, 'Note', folder);
    await setFloor(ownerApi, folder, 'space');
    await setFloor(ownerApi, note, 'space');

    // A space member (read + create, ADR-0017 D5-revision) copies the shared tree.
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await apiFor(member);
    const res = await memberApi.post('/author/graph/copy', {
      data: { spaceId: tenant.spaceId, sourceId: folder, targetFolderId: null },
    });
    expect(res.status()).toBe(201);
    const copied = (await res.json()) as { node_id: string; count: number };
    expect(copied.count).toBe(2);

    // The copies are the MEMBER's own PRIVATE drafts — the space audience is NOT
    // carried over (fail-closed: copy never re-broadcasts the source's reach).
    const copyRoot = await resource(tenant, copied.node_id);
    expect(copyRoot).toMatchObject({
      owner_user_id: member.userId,
      visibility: 'private',
    });
    const copyNote = await resource(
      tenant,
      await onlyChild(tenant, copied.node_id)
    );
    expect(copyNote).toMatchObject({
      kind: 'text',
      owner_user_id: member.userId,
      visibility: 'private',
    });

    // The source stays space-shared (untouched by the copy).
    expect((await resource(tenant, folder)).visibility).toBe('space');

    await ownerApi.dispose();
    await memberApi.dispose();
  });
});
