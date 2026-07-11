/**
 * "Shared with me" mechanism distinction — (the DATA layer, Wave 3a).
 *
 * The graph annotates each node in the `'shared'` lens (visible nodes a user does NOT
 * own) with the single WINNING mechanism that grants THAT user access, precedence
 * `personal > cohort > broadcast` (`annotateShareMechanism` →
 * `KbViewData.shareMechanism`). This route/data-level proof asserts that the SHARED
 * `SHARE_MECHANISM_SCENARIO` fixture sets up exactly the four admitting mechanisms the
 * badge will render — so the Wave 3b RENDER agent's badge/facet spec can layer its DOM
 * assertions on the SAME fixture (via `seedShareMechanismFixture`) instead of inline-
 * building a tree.
 *
 * The whole tree + every grant come from the shared catalog entry (via
 * `seedShareMechanismFixture`): the per-user grants from the `owner` through the live
 * Share transport, the cohort link + the viewer's membership from the access-manager,
 * the floor publish from the owner — every row created at runtime under each actor's own
 * RLS, never a migration seed. No inline `createFolder`/`createDoc`, no hand-built tree.
 *
 * `annotateShareMechanism` derives each mechanism from three RLS-scoped reads, run AS the
 * viewer: (1) `knowledge_resource_user_grants` for me → `personal`; (2)
 * `knowledge_resource_scopes` ⋈ my cohorts → `cohort`; (3) the residual → `broadcast`.
 * This spec asserts those same source-of-truth facts under the viewer's OWN RLS — so a
 * green run proves the fixture yields `personal` / `cohort` / `broadcast` AND that the
 * both-granted node wins as `personal` (precedence). The fanout reads the viewer's
 * cohorts via the `knowledge_user_scope_ids()` RPC (a plain `member` lacks the legacy
 * `space.content.read` the `scope_memberships` SELECT RLS gates on); we assert the same
 * RPC returns the cohort here, so a `member`'s cohort node never mislabels as broadcast.
 *
 * Tagged `@full` — needs the running Supabase + author stack.
 */
import { type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import {
  bootstrapKnowledgeGraphTenant,
  seedShareMechanismFixture,
  teardownKnowledgeGraphTenant,
  type KnowledgeGraphTenant,
  type ShareMechanismFixture,
} from './helpers/knowledge-graph-bootstrap.js';

/** Can this actor SEE the resource? RLS is the fence — a hidden row is ABSENT. */
async function canSee(
  db: SupabaseClient,
  resourceId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('id', resourceId)
    .maybeSingle();
  expect(error).toBeNull();
  return data?.id === resourceId;
}

/** Is `resourceId` personally granted to me? (the `personal` read, under my RLS) */
async function isPersonallyGranted(
  db: SupabaseClient,
  me: string,
  resourceId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('knowledge_resource_user_grants')
    .select('resource_id')
    .eq('user_id', me)
    .eq('resource_id', resourceId);
  expect(error).toBeNull();
  return (data ?? []).length > 0;
}

/** Is `resourceId` fenced to a cohort I belong to? (the `cohort` read, under my RLS).
 * Mirrors the fanout: my cohorts via the `knowledge_user_scope_ids()` RPC (a `member`
 * can't read `scope_memberships` directly), then `knowledge_resource_scopes` over them. */
async function isCohortFenced(
  db: SupabaseClient,
  resourceId: string
): Promise<boolean> {
  const { data: scopeIds, error: scopeErr } = await db.rpc(
    'knowledge_user_scope_ids'
  );
  expect(scopeErr).toBeNull();
  const myScopeIds = Array.from(new Set((scopeIds ?? []) as string[]));
  if (myScopeIds.length === 0) return false;
  const { data, error } = await db
    .from('knowledge_resource_scopes')
    .select('resource_id')
    .in('scope_id', myScopeIds)
    .eq('resource_id', resourceId);
  expect(error).toBeNull();
  return (data ?? []).length > 0;
}

/** Re-derive the WINNING mechanism for `resourceId` AS the viewer, exactly as
 * `annotateShareMechanism` does: personal > cohort > broadcast over the already-visible
 * node. (The caller asserts the node is visible first, so `broadcast` is a true residual.) */
async function mechanismFor(
  db: SupabaseClient,
  me: string,
  resourceId: string
): Promise<'personal' | 'cohort' | 'broadcast'> {
  if (await isPersonallyGranted(db, me, resourceId)) return 'personal';
  if (await isCohortFenced(db, resourceId)) return 'cohort';
  return 'broadcast';
}

test.describe('shared-with-me mechanism distinction — @full', () => {
  test.describe.configure({ timeout: 180_000 });

  let tenant: KnowledgeGraphTenant;
  let fx: ShareMechanismFixture;

  test.beforeAll(async () => {
    tenant = await bootstrapKnowledgeGraphTenant();
    fx = await seedShareMechanismFixture(tenant);
  });

  test.afterAll(async () => {
    if (tenant) {
      await teardownKnowledgeGraphTenant(
        tenant,
        [fx?.viewer.userId, fx?.owner.userId].filter((id): id is string =>
          Boolean(id)
        )
      );
    }
  });

  test('(0) all four nodes are in the viewer’s shared lens (owner ≠ viewer, visible-not-owned)', async () => {
    const db = fx.viewer.client;
    // The viewer does NOT own any of them (the owner does) yet SEES all four — the
    // exact "visible nodes I do not own" set the `'shared'` lens (and the annotation)
    // operate over.
    for (const id of [
      fx.personalNodeId,
      fx.cohortNodeId,
      fx.broadcastNodeId,
      fx.bothNodeId,
    ]) {
      expect(await canSee(db, id)).toBe(true);
    }
  });

  test('(1) a per-user grant annotates `personal`', async () => {
    const mech = await mechanismFor(
      fx.viewer.client,
      fx.viewer.userId,
      fx.personalNodeId
    );
    expect(mech).toBe(fx.expected.personal); // 'personal'
  });

  test('(2) a cohort the viewer belongs to annotates `cohort` (member, via the RPC)', async () => {
    // The viewer is a plain `member`; the cohort read must go through
    // `knowledge_user_scope_ids()` (a direct `scope_memberships` select would return
    // nothing and mislabel this as broadcast). The fixture seeds the membership, so:
    const mech = await mechanismFor(
      fx.viewer.client,
      fx.viewer.userId,
      fx.cohortNodeId
    );
    expect(mech).toBe(fx.expected.cohort); // 'cohort'
    // …and it is NOT personally granted (the cohort branch is the sole disjunct here).
    expect(
      await isPersonallyGranted(
        fx.viewer.client,
        fx.viewer.userId,
        fx.cohortNodeId
      )
    ).toBe(false);
  });

  test('(3) a space-floor publish annotates `broadcast` (the residual)', async () => {
    const mech = await mechanismFor(
      fx.viewer.client,
      fx.viewer.userId,
      fx.broadcastNodeId
    );
    expect(mech).toBe(fx.expected.broadcast); // 'broadcast'
    // The residual is a true residual: neither a personal grant nor a cohort admits it.
    expect(
      await isPersonallyGranted(
        fx.viewer.client,
        fx.viewer.userId,
        fx.broadcastNodeId
      )
    ).toBe(false);
    expect(await isCohortFenced(fx.viewer.client, fx.broadcastNodeId)).toBe(
      false
    );
  });

  test('(4) precedence: a node BOTH personally granted AND cohort-fenced wins as `personal`', async () => {
    // BOTH mechanisms admit it — both source reads return true…
    expect(
      await isPersonallyGranted(
        fx.viewer.client,
        fx.viewer.userId,
        fx.bothNodeId
      )
    ).toBe(true);
    expect(await isCohortFenced(fx.viewer.client, fx.bothNodeId)).toBe(true);
    // …yet the WINNING annotation is the most deliberate one: personal > cohort.
    const mech = await mechanismFor(
      fx.viewer.client,
      fx.viewer.userId,
      fx.bothNodeId
    );
    expect(mech).toBe(fx.expected.both); // 'personal'
  });
});
