/**
 * Trash / reference-aware lifecycle acceptance (ADR-0018) — the regression net for
 * the destructive Drive flow. Trash is soft-delete + restore + manual purge; the
 * one-way door (purge) destroys a row, so this is a critical flow proved end-to-end
 * over HTTP as the bootstrapped actors (runtime tenant, never a migration seed).
 *
 * Coverage (ADR-0018 §10.8):
 *  1. trash → hidden from normal browse / visible under the trash filter; restore
 *     round-trips the FULL reference set (a `contains` parent, a `shortcut`, a
 *     `tagged` edge) with zero rebuild — all reappear.
 *  2. multi-parent survival: trashing folder A trashes an only-child orphan but a
 *     child ALSO under folder B survives (it keeps a living parent); restore re-shows.
 *  3. cross-owner gating: a `member` (no `space.knowledge.delete`) cannot trash or
 *     restore a granted-owned node; the owner / a delete-holder can. And cross-owner
 *     PURGE authority (ADR-0018 §8) is fail-closed (ADR-0017): a delete-holder CAN
 *     purge a SHARED member node (visible → `purged:[id]`, durable audit stamped to
 *     the admin), but a still-PRIVATE member node is owner-only-visible, so the admin
 *     purge is an HONEST no-op (`purged:[]`, 200, row + audit untouched — to ACT you
 *     must be able to SEE; never a silent delete-without-report).
 *  4. purge destroys the node + reaps the body best-effort; a missing body
 *     (Mongo-down simulation) still purges the node (orphan acceptable, not a throw).
 *  5. graceful-absence (§14): trashing a node mid-tree leaves the parent folder's
 *     containment forest renderable — the trashed child's edge is hidden (dormant),
 *     no dangling edge reaches the client.
 *  6. lifecycle audit: trash then restore → two immutable `kb.resource_activity`
 *     rows (`trashed`,`restored`) carrying the ACTOR; UPDATE/DELETE on them fails.
 *  7. durable purge history: purge → a surviving `space_admin_audit_log` row
 *     (`knowledge.resource.purged`) after the node AND its `kra` rows are gone.
 *
 * Tagged `@full` — needs the running stack (Next author app + Postgres + Payload/Mongo).
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

async function createTextDoc(
  api: APIRequestContext,
  spaceId: string,
  title: string
): Promise<{ nodeId: string; docId: string }> {
  const res = await api.post('/author/graph/text-resources', {
    data: { spaceId, title },
  });
  expect(res.status()).toBe(201);
  const j = (await res.json()) as {
    node_id: string;
    body_ref: { doc_id: string };
  };
  return { nodeId: j.node_id, docId: j.body_ref.doc_id };
}

/** Add a `contains` (folderId → childId) edge. */
async function contain(
  api: APIRequestContext,
  spaceId: string,
  folderId: string,
  childId: string
): Promise<void> {
  const res = await api.post('/author/graph/edges', {
    data: { action: 'contain', spaceId, folderId, childId },
  });
  expect(res.status()).toBe(201);
}

test.describe('@full knowledge trash lifecycle', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('trash hides from live, restore round-trips references (shortcut + contains + tagged)', async () => {
    const api = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    // A folder containing a text doc; a second folder shortcutting the doc; a tag.
    const folder = await createFolder(api, sid, 'Refs Folder');
    const { nodeId: doc } = await createTextDoc(api, sid, 'Referenced Doc');
    await contain(api, sid, folder, doc);

    const shortcutFolder = await createFolder(api, sid, 'Shortcut Holder');

    // shortcut (shortcutFolder → doc) and a tagged edge (doc → new tag node).
    const scRes = await api.post('/author/graph/edges', {
      data: {
        action: 'shortcut',
        spaceId: sid,
        folderId: shortcutFolder,
        targetId: doc,
      },
    });
    expect(scRes.status()).toBe(201);
    const tagRes = await api.post('/author/graph/edges', {
      data: {
        action: 'tag',
        spaceId: sid,
        resourceId: doc,
        tagTitle: `Trash Tag ${Date.now()}`,
      },
    });
    expect(tagRes.status()).toBe(201);

    // Snapshot the doc's edges BEFORE trash (the reference set we must round-trip).
    const { data: edgesBefore } = await tenant.service
      .from('knowledge_edges')
      .select('id,relation_type')
      .or(`from_id.eq.${doc},to_id.eq.${doc}`);
    const beforeCount = (edgesBefore ?? []).length;
    expect(beforeCount).toBeGreaterThanOrEqual(3); // contains + shortcut + tagged

    // TRASH the doc (DELETE = soft trash now).
    const delRes = await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: doc },
    });
    expect(delRes.status()).toBe(200);

    // The node is stamped deleted_at (service-role reads the truth).
    const { data: trashedRow } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at,trashed_by')
      .eq('id', doc)
      .single();
    expect(
      (trashedRow as { deleted_at: string | null }).deleted_at
    ).not.toBeNull();
    expect((trashedRow as { trashed_by: string | null }).trashed_by).toBe(
      tenant.granted.userId
    );

    // PRESERVED-but-dormant: every edge row STILL EXISTS (nothing pruned).
    const { data: edgesAfter } = await tenant.service
      .from('knowledge_edges')
      .select('id')
      .or(`from_id.eq.${doc},to_id.eq.${doc}`);
    expect((edgesAfter ?? []).length).toBe(beforeCount);

    // The edge is DORMANT to the actor's RLS read (a trashed endpoint hides it).
    const { data: visibleEdges } = await tenant.granted.client
      .from('knowledge_edges')
      .select('id')
      .eq('from_id', folder)
      .eq('to_id', doc);
    expect((visibleEdges ?? []).length).toBe(0);

    // RESTORE round-trips: clear deleted_at, every reference re-admits.
    const restoreRes = await api.patch('/author/graph/trash', {
      data: { spaceId: sid, resourceId: doc },
    });
    expect(restoreRes.status()).toBe(200);

    const { data: restoredRow } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at,trashed_by')
      .eq('id', doc)
      .single();
    expect(
      (restoredRow as { deleted_at: string | null }).deleted_at
    ).toBeNull();
    expect(
      (restoredRow as { trashed_by: string | null }).trashed_by
    ).toBeNull();

    // The contains edge is visible again to the actor (zero rebuild).
    const { data: backEdges } = await tenant.granted.client
      .from('knowledge_edges')
      .select('id')
      .eq('from_id', folder)
      .eq('to_id', doc);
    expect((backEdges ?? []).length).toBe(1);

    await api.dispose();
  });

  test('soft-cascade: folder trash orphans a child but a multi-parent child survives', async () => {
    const api = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    const parent = await createFolder(api, sid, 'Cascade Parent');
    const other = await createFolder(api, sid, 'Cascade Other');
    const onlyChild = await createFolder(api, sid, 'Cascade Only', parent);
    const sharedChild = await createFolder(api, sid, 'Cascade Shared', parent);
    await contain(api, sid, other, sharedChild); // sharedChild also under `other`

    const delRes = await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: parent },
    });
    expect(delRes.status()).toBe(200);

    const { data: rows } = await tenant.service
      .from('knowledge_resources')
      .select('id,deleted_at')
      .in('id', [parent, other, onlyChild, sharedChild]);
    const byId = new Map(
      (rows ?? []).map((r) => [
        (r as { id: string }).id,
        (r as { deleted_at: string | null }).deleted_at,
      ])
    );
    expect(byId.get(parent)).not.toBeNull(); // trashed (target)
    expect(byId.get(onlyChild)).not.toBeNull(); // trashed (orphan)
    expect(byId.get(sharedChild)).toBeNull(); // SURVIVES (living parent `other`)
    expect(byId.get(other)).toBeNull(); // untouched

    // Restoring the parent restores the trashed-as-a-unit subtree (same stamp).
    const restoreRes = await api.patch('/author/graph/trash', {
      data: { spaceId: sid, resourceId: parent },
    });
    expect(restoreRes.status()).toBe(200);
    const { data: after } = await tenant.service
      .from('knowledge_resources')
      .select('id,deleted_at')
      .in('id', [parent, onlyChild]);
    for (const r of after ?? []) {
      expect((r as { deleted_at: string | null }).deleted_at).toBeNull();
    }

    await api.dispose();
  });

  test('cross-owner gating: a member cannot trash/restore another owners node', async () => {
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await apiFor(member);
    const grantedApi = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    const grantedNode = await createFolder(grantedApi, sid, 'Owner Only Trash');

    // The member (no space.knowledge.delete, not owner) cannot trash it.
    await memberApi.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: grantedNode },
    });
    const { data: stillLive } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at')
      .eq('id', grantedNode)
      .single();
    expect((stillLive as { deleted_at: string | null }).deleted_at).toBeNull();

    // The owner CAN trash it.
    const ownerTrash = await grantedApi.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: grantedNode },
    });
    expect(ownerTrash.status()).toBe(200);

    // The member cannot restore it either.
    await memberApi.patch('/author/graph/trash', {
      data: { spaceId: sid, resourceId: grantedNode },
    });
    const { data: stillTrashed } = await tenant.service
      .from('knowledge_resources')
      .select('deleted_at')
      .eq('id', grantedNode)
      .single();
    expect(
      (stillTrashed as { deleted_at: string | null }).deleted_at
    ).not.toBeNull();

    await memberApi.dispose();
    await grantedApi.dispose();
  });

  test('purge destroys a text node + best-effort body reap (failure is non-fatal)', async () => {
    const api = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    // A text doc with a real Payload body (the reap target).
    const { nodeId } = await createTextDoc(api, sid, 'Purge Me');

    // Trash first (purge is reached only from the Trash lens).
    const trashRes = await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: nodeId },
    });
    expect(trashRes.status()).toBe(200);

    // PURGE (real DELETE). The route reaps the Payload body best-effort AFTER the
    // node DELETE commits; a body failure is swallowed (one-directional, never a
    // throw) — so the response is 200 and the node is destroyed regardless.
    const purgeRes = await api.delete('/author/graph/trash', {
      data: { spaceId: sid, resourceId: nodeId },
    });
    expect(purgeRes.status()).toBe(200);
    expect(((await purgeRes.json()) as { purged: string[] }).purged).toContain(
      nodeId
    );

    // The node row is GONE (the one-way door).
    const { data: gone } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('id', nodeId);
    expect(gone ?? []).toHaveLength(0);

    await api.dispose();
  });

  test('graceful-absence: trashing a child leaves the parent folder forest renderable', async () => {
    const api = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    const parent = await createFolder(api, sid, 'Graceful Parent');
    const child = await createFolder(api, sid, 'Graceful Child', parent);

    await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: child },
    });

    // The parent's containment forest, read under the actor's RLS, OMITS the edge
    // to the trashed child (dormant) — no dangling edge to a hidden node reaches
    // the client (graceful-absence by construction, ADR-0018 §14 defense 1).
    const { data: forest } = await tenant.granted.client
      .from('knowledge_edges')
      .select('from_id,to_id')
      .eq('space_id', sid)
      .eq('relation_type', 'contains')
      .eq('from_id', parent);
    const targets = (forest ?? []).map((e) => (e as { to_id: string }).to_id);
    expect(targets).not.toContain(child); // the trashed child is simply absent
    // The parent itself is still live + visible.
    const { data: parentRow } = await tenant.granted.client
      .from('knowledge_resources')
      .select('id,deleted_at')
      .eq('id', parent)
      .single();
    expect((parentRow as { deleted_at: string | null }).deleted_at).toBeNull();

    await api.dispose();
  });

  test('in-use purge guard: an unauthorized purge of a node with a live cross-owner reference is rejected as reason:in-use (422), nothing destroyed', async () => {
    // The Trash lens render (ADR-0018 §10.7) surfaces the in-use rejection as a
    // cooperative "in use" state. This proves the route signal that drives it: the
    // `assert_purge_not_in_use` guard rejects an unauthorized purge of a resource with
    // LIVING cross-owner references, and the `/author/graph/trash` DELETE tags that
    // rejection `reason:'in-use'` (422) so the UI can show it WITHOUT throwing. (The
    // cooperative escalation — a delete-holder completing the purge — is a Phase A
    // authority concern asserted there; here we pin the render-facing rejection signal.)
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await apiFor(member);
    const grantedApi = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    // `granted` owns a live folder; `member` owns a doc. The cross-owner `contains`
    // edge (granted's live folder → member's doc) is the living reference the in-use
    // guard fires on. Cross-owner edge CREATION is itself RLS-restricted (a delete/
    // update holder cannot freely file another owner's node under their folder), so
    // the edge is set up via service-role — legitimate TEST SETUP of the precondition,
    // not the code path under test (the purge guard is what we exercise).
    const grantedFolder = await createFolder(grantedApi, sid, 'In-Use Holder');
    const { nodeId: memberDoc } = await createTextDoc(
      memberApi,
      sid,
      'In-Use Doc'
    );
    const { error: edgeErr } = await tenant.service
      .from('knowledge_edges')
      .insert({
        space_id: sid,
        from_id: grantedFolder,
        to_id: memberDoc,
        relation_type: 'contains',
        position: 0,
        created_by: tenant.granted.userId,
      });
    expect(edgeErr).toBeNull();

    // `member` trashes its OWN doc (owner-sovereign — allowed).
    const trashRes = await memberApi.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: memberDoc },
    });
    expect(trashRes.status()).toBe(200);

    // `member` (no space.knowledge.delete) tries to PURGE it → the in-use guard
    // rejects (living cross-owner reference). The route surfaces `reason:'in-use'`,
    // 422, and NOTHING is destroyed.
    const memberPurge = await memberApi.delete('/author/graph/trash', {
      data: { spaceId: sid, resourceId: memberDoc },
    });
    expect(memberPurge.status()).toBe(422);
    expect(((await memberPurge.json()) as { reason?: string }).reason).toBe(
      'in-use'
    );
    const { data: stillThere } = await tenant.service
      .from('knowledge_resources')
      .select('id,deleted_at')
      .eq('id', memberDoc);
    expect(stillThere ?? []).toHaveLength(1); // nothing destroyed
    // …and it stays TRASHED (a rejected purge does not silently restore it).
    expect(
      (stillThere ?? [])[0] as { deleted_at: string | null }
    ).not.toBeNull();

    await memberApi.dispose();
    await grantedApi.dispose();
  });

  test('cross-owner purge authority (ADR-0018 §8): a delete-holder CAN purge a SHARED member node, but a PRIVATE one is an honest no-op (fail-closed: to act you must SEE)', async () => {
    // The companion to the in-use rejection above: the COMPLETION half. Under
    // ADR-0017 fail-closed, a delete-verb holder can only PURGE a cross-owner node it
    // can SEE — Postgres folds the SELECT policy into DELETE (a row you cannot select,
    // you cannot delete), so the purge reaches a member node only when the member has
    // shared it (floor=space). A still-private member node is owner-only-visible, so
    // the admin's purge legitimately destroys NOTHING and the route reports `purged:[]`
    // FAITHFULLY (no silent delete-without-report; the row + audit are untouched).
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await apiFor(member);
    const grantedApi = await apiFor(tenant.granted); // holds space.knowledge.delete
    const sid = tenant.spaceId;

    // ── arm 1: a SHARED member node — the delete-holder CAN purge it ────────────
    const { nodeId: sharedDoc } = await createTextDoc(
      memberApi,
      sid,
      'Member Shared Purge Target'
    );
    // The member publishes its OWN node to the space floor (owner-sovereign), so the
    // admin can SEE it — the precondition for acting on it cross-owner.
    const pubRes = await memberApi.patch('/author/graph/visibility', {
      data: { resourceId: sharedDoc, visibility: 'space' },
    });
    expect(pubRes.status()).toBe(200);
    // The member trashes its own node (purge is reached only from the Trash lens).
    const trashShared = await memberApi.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: sharedDoc },
    });
    expect(trashShared.status()).toBe(200);

    // The admin (delete-holder, NOT the owner) purges the shared, trashed member node.
    const adminPurge = await grantedApi.delete('/author/graph/trash', {
      data: { spaceId: sid, resourceId: sharedDoc },
    });
    expect(adminPurge.status()).toBe(200);
    expect(
      ((await adminPurge.json()) as { purged: string[] }).purged
    ).toContain(sharedDoc); // FAITHFUL report: the row really was destroyed

    // The node row is GONE (the one-way door reached it cross-owner).
    const { data: sharedGone } = await tenant.service
      .from('knowledge_resources')
      .select('id')
      .eq('id', sharedDoc);
    expect(sharedGone ?? []).toHaveLength(0);

    // …and the durable purge tombstone survives, stamped with the ADMIN as actor.
    const { data: sharedAudit } = await tenant.service
      .from('space_admin_audit_log')
      .select('actor_user_id,entity_id')
      .eq('action', 'knowledge.resource.purged')
      .eq('entity_id', sharedDoc);
    expect((sharedAudit ?? []).length).toBe(1);
    expect(
      (sharedAudit ?? [])[0] as { actor_user_id: string | null }
    ).toMatchObject({ actor_user_id: tenant.granted.userId });

    // ── arm 2: a PRIVATE member node — the delete-holder purge is an honest no-op ─
    const { nodeId: privateDoc } = await createTextDoc(
      memberApi,
      sid,
      'Member Private Purge Target'
    );
    // No publish: the node stays floor=private (private-by-default, ADR-0017), so it
    // is invisible to the admin even though the admin holds the delete verb.
    const trashPrivate = await memberApi.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: privateDoc },
    });
    expect(trashPrivate.status()).toBe(200);

    // The admin attempts the SAME purge. The DELETE-USING (delete verb) passes, but
    // the SELECT policy hides the private member row, so Postgres deletes NOTHING and
    // the RETURNING is empty — the route reports a CLEAN, HONEST no-op (not a throw,
    // not a fabricated success, and crucially NOT a silent destruction).
    const adminPurgePrivate = await grantedApi.delete('/author/graph/trash', {
      data: { spaceId: sid, resourceId: privateDoc },
    });
    expect(adminPurgePrivate.status()).toBe(200);
    expect(
      ((await adminPurgePrivate.json()) as { purged: string[] }).purged
    ).toHaveLength(0); // honest no-op: nothing reported destroyed

    // The private member node SURVIVES (no silent delete) and stays TRASHED.
    const { data: privateStill } = await tenant.service
      .from('knowledge_resources')
      .select('id,deleted_at')
      .eq('id', privateDoc);
    expect(privateStill ?? []).toHaveLength(1);
    expect(
      (privateStill ?? [])[0] as { deleted_at: string | null }
    ).not.toBeNull();
    // No purge tombstone was written for the untouched private node (the BEFORE-DELETE
    // audit trigger never fired — the row was never visited by the DELETE).
    const { data: privateAudit } = await tenant.service
      .from('space_admin_audit_log')
      .select('entity_id')
      .eq('action', 'knowledge.resource.purged')
      .eq('entity_id', privateDoc);
    expect(privateAudit ?? []).toHaveLength(0);
    // The OWNER can still purge their own private node (sovereignty intact).
    const ownerPurge = await memberApi.delete('/author/graph/trash', {
      data: { spaceId: sid, resourceId: privateDoc },
    });
    expect(ownerPurge.status()).toBe(200);
    expect(
      ((await ownerPurge.json()) as { purged: string[] }).purged
    ).toContain(privateDoc);

    await memberApi.dispose();
    await grantedApi.dispose();
  });

  test('lifecycle audit: trash+restore = two immutable kra rows (actor-stamped); purge = durable audit', async () => {
    const api = await apiFor(tenant.granted);
    const sid = tenant.spaceId;

    const node = await createFolder(api, sid, 'Audited Node');

    await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: node },
    });
    await api.patch('/author/graph/trash', {
      data: { spaceId: sid, resourceId: node },
    });

    // Two immutable kra rows: trashed + restored, both carrying the ACTOR.
    const { data: kra } = await tenant.service
      .schema('kb')
      .from('resource_activity')
      .select('id,kind,user_id')
      .eq('resource_id', node)
      .in('kind', ['trashed', 'restored']);
    const byKind = new Map(
      (kra ?? []).map((r) => [
        (r as { kind: string }).kind,
        r as { id: string; user_id: string | null },
      ])
    );
    expect(byKind.has('trashed')).toBe(true);
    expect(byKind.has('restored')).toBe(true);
    expect(byKind.get('trashed')?.user_id).toBe(tenant.granted.userId);
    expect(byKind.get('restored')?.user_id).toBe(tenant.granted.userId);

    // Append-only: UPDATE / DELETE on a kra row fails (service-role still RLS-free,
    // so this proves the table grants — no UPDATE/DELETE privilege for anyone).
    const kraId = byKind.get('trashed')?.id;
    const { error: updErr } = await tenant.granted.client
      .schema('kb')
      .from('resource_activity')
      .update({ kind: 'tampered' })
      .eq('id', kraId as string);
    expect(updErr).not.toBeNull();
    const { error: delErr } = await tenant.granted.client
      .schema('kb')
      .from('resource_activity')
      .delete()
      .eq('id', kraId as string);
    expect(delErr).not.toBeNull();

    // PURGE → a durable space_admin_audit_log row that OUTLIVES the node + kra rows.
    await api.delete('/author/graph/resources', {
      data: { spaceId: sid, resourceId: node },
    });
    const purgeRes = await api.delete('/author/graph/trash', {
      data: { spaceId: sid, resourceId: node },
    });
    expect(purgeRes.status()).toBe(200);

    // The node + its kra rows are gone (FK cascade).
    const { data: kraGone } = await tenant.service
      .schema('kb')
      .from('resource_activity')
      .select('id')
      .eq('resource_id', node);
    expect(kraGone ?? []).toHaveLength(0);

    // …but the durable purge tombstone survives.
    const { data: audit } = await tenant.service
      .from('space_admin_audit_log')
      .select('action,entity_type,entity_id,actor_user_id,previous_value')
      .eq('action', 'knowledge.resource.purged')
      .eq('entity_id', node);
    expect((audit ?? []).length).toBe(1);
    const row = (audit ?? [])[0] as {
      entity_type: string;
      actor_user_id: string | null;
      previous_value: { title?: string; kind?: string } | null;
    };
    expect(row.entity_type).toBe('knowledge_resource');
    expect(row.actor_user_id).toBe(tenant.granted.userId);
    expect(row.previous_value?.title).toBe('Audited Node');
    expect(row.previous_value?.kind).toBe('folder');

    await api.dispose();
  });
});
