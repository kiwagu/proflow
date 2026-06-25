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
 * Driven over HTTP through the SHARED seed client; the deep-copy input is the shared
 * `drive-copy-chain` catalog fixture (one dictionary for seed + tests). Runtime
 * tenant, never a migration seed. Tagged `@full` — needs the running stack. Truth is
 * read back with service-role (bypasses RLS) — the body lives in Payload, but the
 * `body_ref` bridge is in Postgres, so body cloning is provable here without Mongo.
 */
import { DRIVE_COPY_CHAIN_SCENARIO } from '@workspace/seed';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  bootstrapMemberActor,
  materializeFixture,
  seedClientFor,
  teardownKnowledgeGraphTenant,
  type KnowledgeGraphTenant,
} from './helpers/knowledge-graph-bootstrap.js';

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

test.describe('@full knowledge deep-copy', () => {
  let tenant: KnowledgeGraphTenant;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
  });

  test.afterAll(async () => {
    await teardownKnowledgeGraphTenant(tenant);
  });

  test('deep: duplicates the contains subtree + clones each body, source untouched', async () => {
    const api = await seedClientFor(tenant.granted);

    // Root → Child → Doc (a text node with a real body) — the shared fixture.
    const { refs } = await materializeFixture(
      DRIVE_COPY_CHAIN_SCENARIO,
      tenant
    );
    const root = refs.get('copy/root')!;
    const child = refs.get('copy/child')!;
    const doc = refs.get('copy/doc')!;
    const srcDoc = await resource(tenant, doc);
    expect(srcDoc.body_ref?.doc_id).toBeTruthy();

    // Copy the whole Root to the top level (the UI builds the "(copy)" suffix and
    // passes it as rootTitle; the route itself stays suffix-agnostic).
    const copied = await api.copy(tenant.spaceId, root, {
      targetFolderId: null,
      rootTitle: 'Root (copy)',
    });
    expect(copied.count).toBe(3); // root + child + doc

    // The new root: owner-pinned, PRIVATE, "(copy)" title — a distinct node.
    expect(copied.nodeId).not.toBe(root);
    const newRoot = await resource(tenant, copied.nodeId);
    expect(newRoot).toMatchObject({
      kind: 'folder',
      title: 'Root (copy)',
      owner_user_id: tenant.granted.userId,
      visibility: 'private',
    });

    // Structure preserved: newRoot → newChild → newDoc, all fresh + private.
    const newChild = await onlyChild(tenant, copied.nodeId);
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
    const ownerApi = await seedClientFor(tenant.granted);

    // granted publishes a folder + doc to the whole space (owner-sovereign floor).
    const folder = await ownerApi.createFolder(tenant.spaceId, 'Shared');
    const { nodeId: note } = await ownerApi.createDoc(tenant.spaceId, 'Note', {
      parentFolderId: folder,
    });
    await ownerApi.setFloor(folder, 'space');
    await ownerApi.setFloor(note, 'space');

    // A space member (read + create, ADR-0017 D5-revision) copies the shared tree.
    const member = await bootstrapMemberActor(tenant);
    const memberApi = await seedClientFor(member);
    const copied = await memberApi.copy(tenant.spaceId, folder, {
      targetFolderId: null,
    });
    expect(copied.count).toBe(2);

    // The copies are the MEMBER's own PRIVATE drafts — the space audience is NOT
    // carried over (fail-closed: copy never re-broadcasts the source's reach).
    const copyRoot = await resource(tenant, copied.nodeId);
    expect(copyRoot).toMatchObject({
      owner_user_id: member.userId,
      visibility: 'private',
    });
    const copyNote = await resource(
      tenant,
      await onlyChild(tenant, copied.nodeId)
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
