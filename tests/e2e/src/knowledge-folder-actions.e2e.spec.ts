/**
 * Folder-action acceptance — the HIGH-SIGNAL regression net for the forward-ported
 * folder action set on the `/author/graph/*` routes. Three tests chosen to catch the
 * most likely failures:
 *
 *  1. SECURITY (RLS boundary): an UNGRANTED actor (space_admin, no knowledge verbs)
 *     is rejected on every write and nothing is persisted. RLS is the sole authority —
 *     a regression here is silent and catastrophic, so it is the #1 catcher.
 *  2. DELETE CASCADE integrity: the bespoke containment-orphan trigger — a child with
 *     only the deleted folder as parent is removed; a child also held by another folder
 *     SURVIVES. Recursive SQL is the easiest thing to break.
 *  3. BREADTH happy-path: one granted flow through create → rename → describe → fence →
 *     delete — any broken route/wiring trips it.
 *
 * Driven over HTTP as the bootstrapped actors (runtime tenant, never a migration seed —
 * the identity-sync lesson). Tagged `@full` — needs the running stack.
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

test.describe('@full knowledge folder actions', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('RLS: an ungranted actor cannot create / describe / fence', async () => {
    const granted = await apiFor(tenant.granted);
    const ungranted = await apiFor(tenant.ungranted);

    // The ungranted actor (no space.knowledge.*) is rejected at the row policy.
    const createRes = await ungranted.post('/author/graph/resources', {
      data: { spaceId: tenant.spaceId, kind: 'folder', title: 'Forbidden' },
    });
    expect(createRes.status()).toBe(422);

    // …and nothing was written (service-role bypasses RLS to check the truth).
    const { data: forbiddenRows } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .eq('title', 'Forbidden');
    expect(forbiddenRows ?? []).toHaveLength(0);

    // A granted-created folder cannot be described or fenced by the ungranted actor.
    const folderId = await createFolder(
      granted,
      tenant.spaceId,
      'Granted Folder'
    );

    const descRes = await ungranted.post('/author/graph/attributes', {
      data: {
        attribute: 'description',
        spaceId: tenant.spaceId,
        nodeId: folderId,
        body: 'should not stick',
      },
    });
    expect(descRes.status()).toBe(422);

    const { data: scope } = await tenant.service
      .from('scopes')
      .insert({
        space_id: tenant.spaceId,
        key: 'rls-cohort',
        name: 'RLS Cohort',
        created_by: tenant.granted.userId,
      })
      .select('id')
      .single();
    const fenceRes = await ungranted.post('/author/graph/visibility', {
      data: { resourceId: folderId, scopeId: (scope as { id: string }).id },
    });
    expect(fenceRes.status()).toBe(422);

    const { data: links } = await tenant.service
      .from('knowledge_resource_scopes')
      .select('scope_id')
      .eq('resource_id', folderId);
    expect(links ?? []).toHaveLength(0);

    await granted.dispose();
    await ungranted.dispose();
  });

  test('delete cascade: orphan child removed, multi-parent child survives', async () => {
    const api = await apiFor(tenant.granted);

    const parent = await createFolder(api, tenant.spaceId, 'Parent');
    const other = await createFolder(api, tenant.spaceId, 'Other');
    // child only inside Parent → becomes an orphan when Parent is deleted.
    const onlyChild = await createFolder(api, tenant.spaceId, 'Only', parent);
    // child inside Parent AND Other → has another parent → must SURVIVE.
    const sharedChild = await createFolder(
      api,
      tenant.spaceId,
      'Shared',
      parent
    );
    const addParent = await api.post('/author/graph/edges', {
      data: {
        action: 'contain',
        spaceId: tenant.spaceId,
        folderId: other,
        childId: sharedChild,
      },
    });
    expect(addParent.status()).toBe(201);

    const delRes = await api.delete('/author/graph/resources', {
      data: { spaceId: tenant.spaceId, resourceId: parent },
    });
    expect(delRes.status()).toBe(200);

    const { data: survivors } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .in('id', [parent, other, onlyChild, sharedChild]);
    const ids = new Set((survivors ?? []).map((r) => (r as { id: string }).id));
    expect(ids.has(parent)).toBe(false); // deleted (target)
    expect(ids.has(onlyChild)).toBe(false); // deleted (orphan)
    expect(ids.has(sharedChild)).toBe(true); // SURVIVES (still under Other)
    expect(ids.has(other)).toBe(true); // untouched

    await api.dispose();
  });

  test('breadth: create → rename → describe → fence → delete', async () => {
    const api = await apiFor(tenant.granted);

    const folderId = await createFolder(api, tenant.spaceId, 'Lifecycle');

    const renameRes = await api.patch('/author/graph/resources', {
      data: { spaceId: tenant.spaceId, resourceId: folderId, title: 'Renamed' },
    });
    expect(renameRes.status()).toBe(200);
    expect((await renameRes.json()).title).toBe('Renamed');

    const descRes = await api.post('/author/graph/attributes', {
      data: {
        attribute: 'description',
        spaceId: tenant.spaceId,
        nodeId: folderId,
        body: 'RAG text',
      },
    });
    expect(descRes.status()).toBe(200);

    // fence to a cohort the granted actor belongs to (so it stays visible to them).
    const { data: scope } = await tenant.service
      .from('scopes')
      .insert({
        space_id: tenant.spaceId,
        key: 'life-cohort',
        name: 'Life Cohort',
        created_by: tenant.granted.userId,
      })
      .select('id')
      .single();
    const scopeId = (scope as { id: string }).id;
    await tenant.service.from('scope_memberships').insert({
      scope_id: scopeId,
      user_id: tenant.granted.userId,
      created_by: tenant.granted.userId,
    });
    const fenceRes = await api.post('/author/graph/visibility', {
      data: { resourceId: folderId, scopeId },
    });
    expect(fenceRes.status()).toBe(201);

    const visRes = await api.get(
      `/author/graph/visibility?space_id=${tenant.spaceId}&node_id=${folderId}`
    );
    const vis = (await visRes.json()) as {
      choices: { id: string; linked: boolean }[];
    };
    expect(vis.choices.find((c) => c.id === scopeId)?.linked).toBe(true);

    const delRes = await api.delete('/author/graph/resources', {
      data: { spaceId: tenant.spaceId, resourceId: folderId },
    });
    expect(delRes.status()).toBe(200);

    const { data: gone } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('id', folderId);
    expect(gone ?? []).toHaveLength(0);

    await api.dispose();
  });
});
