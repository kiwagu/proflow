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
 * Driven over HTTP as the bootstrapped actors through the SHARED seed client (the
 * `/author/graph/*` create-vocabulary), and the cascade shape comes from the shared
 * `drive-cascade` catalog fixture — one dictionary for the seed and the tests.
 * Runtime tenant, never a migration seed. Tagged `@full` — needs the running stack.
 */
import { DRIVE_CASCADE_SCENARIO } from '@workspace/seed';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  bootstrapMemberActor,
  materializeFixture,
  seedClientFor,
  teardownKnowledgeGraphTenant,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

test.describe('@full knowledge folder actions', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('RLS: an ungranted actor cannot create / describe / fence', async () => {
    const granted = await seedClientFor(tenant.granted);
    const ungranted = await seedClientFor(tenant.ungranted);

    // The ungranted actor (no space.knowledge.*) is rejected at the row policy.
    const createRes = await ungranted.post('/author/graph/resources', {
      spaceId: tenant.spaceId,
      kind: 'folder',
      title: 'Forbidden',
    });
    expect(createRes.status).toBe(422);

    // …and nothing was written (service-role bypasses RLS to check the truth).
    const { data: forbiddenRows } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', tenant.spaceId)
      .eq('title', 'Forbidden');
    expect(forbiddenRows ?? []).toHaveLength(0);

    // A granted-created folder cannot be described or fenced by the ungranted actor.
    const folderId = await granted.createFolder(
      tenant.spaceId,
      'Granted Folder'
    );

    const descRes = await ungranted.post('/author/graph/attributes', {
      attribute: 'description',
      spaceId: tenant.spaceId,
      nodeId: folderId,
      body: 'should not stick',
    });
    expect(descRes.status).toBe(422);

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
      resourceId: folderId,
      scopeId: (scope as { id: string }).id,
    });
    expect(fenceRes.status).toBe(422);

    const { data: links } = await tenant.service
      .from('knowledge_resource_scopes')
      .select('scope_id')
      .eq('resource_id', folderId);
    expect(links ?? []).toHaveLength(0);

    await granted.dispose();
    await ungranted.dispose();
  });

  test('delete = soft-trash cascade: orphan child trashed, multi-parent child survives', async () => {
    // The cascade shape (Parent → {Only, Shared}, with Shared ALSO under Other) is
    // the shared `drive-cascade` fixture from the dictionary.
    const { refs } = await materializeFixture(DRIVE_CASCADE_SCENARIO, tenant);
    const parent = refs.get('cascade/parent')!;
    const other = refs.get('cascade/other')!;
    const onlyChild = refs.get('cascade/only')!;
    const sharedChild = refs.get('cascade/shared')!;

    const api = await seedClientFor(tenant.granted);

    // DELETE now TRASHES (soft, reference-aware). The orphan rule is
    // mirrored as a soft cascade: rows are stamped deleted_at, NOT destroyed.
    await api.trash(tenant.spaceId, parent);

    const { data: rows } = await tenant.service
      .from('knowledge_resources')
      .select('id,deleted_at')
      .in('id', [parent, other, onlyChild, sharedChild]);
    const trashed = new Map(
      (rows ?? []).map((r) => [
        (r as { id: string }).id,
        (r as { deleted_at: string | null }).deleted_at !== null,
      ])
    );
    // Every row still EXISTS (soft-delete) — only the lifecycle flag differs.
    expect(rows ?? []).toHaveLength(4);
    expect(trashed.get(parent)).toBe(true); // trashed (target)
    expect(trashed.get(onlyChild)).toBe(true); // trashed (orphan)
    expect(trashed.get(sharedChild)).toBe(false); // SURVIVES (living parent Other)
    expect(trashed.get(other)).toBe(false); // untouched

    await api.dispose();
  });

  test('breadth: create → rename → describe → fence → delete', async () => {
    const api = await seedClientFor(tenant.granted);

    const folderId = await api.createFolder(tenant.spaceId, 'Lifecycle');

    await api.rename(tenant.spaceId, folderId, 'Renamed');
    await api.describe(tenant.spaceId, folderId, 'RAG text');

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
    await api.linkScope(folderId, scopeId);

    const visRes = await api.get(
      `/author/graph/visibility?space_id=${tenant.spaceId}&node_id=${folderId}`
    );
    const vis = visRes.body as { choices: { id: string; linked: boolean }[] };
    expect(vis.choices.find((c) => c.id === scopeId)?.linked).toBe(true);

    // DELETE now TRASHES (soft): the row survives, stamped deleted_at.
    await api.trash(tenant.spaceId, folderId);

    const { data: trashedRow } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at')
      .eq('id', folderId)
      .single();
    expect(
      (trashedRow as { deleted_at: string | null }).deleted_at
    ).not.toBeNull();

    await api.dispose();
  });

  test('personal authoring: a member authors its OWN, cannot touch others', async () => {
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await seedClientFor(member);
    const grantedApi = await seedClientFor(tenant.granted);

    // A `member` CAN create its own content (read + create → a personal Drive).
    const ownFolder = await memberApi.createFolder(
      tenant.spaceId,
      'Member Drive'
    );
    const { data: ownRow } = await tenant.service
      .from('knowledge_resources')
      .select('owner_user_id,visibility')
      .eq('id', ownFolder)
      .single();
    // owned by the member, and private-by-default (Step 3 — a private draft).
    expect((ownRow as { owner_user_id: string }).owner_user_id).toBe(
      member.userId
    );
    expect((ownRow as { visibility: string }).visibility).toBe('private');

    // Owner-sovereign: the member edits its OWN node WITHOUT the update verb.
    await memberApi.rename(tenant.spaceId, ownFolder, 'My Drive');

    // …but CANNOT edit a granted-owned node (not owner, no update verb). Assert the DB
    // is unchanged (robust to however the route reports a 0-row update).
    const grantedFolder = await grantedApi.createFolder(
      tenant.spaceId,
      'Granted Only'
    );
    await memberApi.patch('/author/graph/resources', {
      spaceId: tenant.spaceId,
      resourceId: grantedFolder,
      title: 'Hijacked',
    });
    const { data: afterRename } = await tenant.service
      .from('knowledge_resources')
      .select('title')
      .eq('id', grantedFolder)
      .single();
    expect((afterRename as { title: string }).title).toBe('Granted Only');

    // …cannot trash a granted-owned node — it stays LIVE (the trash authority
    // guard blocks a non-owner without space.knowledge.delete).
    await memberApi.del('/author/graph/resources', {
      spaceId: tenant.spaceId,
      resourceId: grantedFolder,
    });
    const { data: survives } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at')
      .eq('id', grantedFolder)
      .single();
    expect((survives as { deleted_at: string | null }).deleted_at).toBeNull();

    // …but CAN trash its OWN (owner-sovereign): the row survives, stamped deleted_at.
    await memberApi.trash(tenant.spaceId, ownFolder);
    const { data: ownTrashed } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at')
      .eq('id', ownFolder)
      .single();
    expect(
      (ownTrashed as { deleted_at: string | null }).deleted_at
    ).not.toBeNull();

    await memberApi.dispose();
    await grantedApi.dispose();
  });
});
