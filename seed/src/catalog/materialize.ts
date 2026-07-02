import type { SupabaseClient } from '@supabase/supabase-js';
import { KB_MEDIA_BUCKET } from '@workspace/knowledge-contracts';

import type { SeedClient } from '../engine/http.js';
import type { SeedActor, SeedTenant } from '../engine/types.js';
import type { BodylessNode, SeedNode, SeedScenario } from './types.js';

/**
 * Caller-supplied wiring: how to build an HTTP client for an actor (CLI → fetch;
 * e2e → Playwright) and how to mint a fresh/stable actor with a system role.
 */
export type MaterializeDeps = {
  tenant: SeedTenant;
  clientFor: (actor: SeedActor) => Promise<SeedClient>;
  mintActor: (ref: string, roleKey: string) => Promise<SeedActor>;
};

export type MaterializedScenario = {
  scenarioId: string;
  /** Every addressable handle → its concrete id: node refs, `tag:<title>`,
   * `scope:<ref>`, `projection:<ref>`. */
  refs: Map<string, string>;
  /** The resolved scenario actors by ref (built-ins `admin`/`viewer` + declared) —
   * so a consuming spec can authenticate AS a participant (e.g. a per-user grantee /
   * outsider) and assert the access matrix the seeded grants set up. */
  actors: Map<string, SeedActor>;
};

/**
 * Walk one scenario through the `/author/graph/*` endpoints (and the owner's RLS
 * client for the few writes no endpoint exposes), returning every `ref → id`.
 * This is the single interpreter both the demo seed and the e2e specs run.
 */
export async function materializeScenario(
  scenario: SeedScenario,
  deps: MaterializeDeps
): Promise<MaterializedScenario> {
  const { tenant } = deps;
  const refs = new Map<string, string>();

  // ── actors ─────────────────────────────────────────────────────────────────
  // The catalog `viewer` ref maps to the tenant's `member` actor (read + create), NOT
  // the verb-less `ungranted` negative actor — so a scenario's `owner: 'viewer'` node
  // authors in BOTH the ephemeral and the demo tenant. (`ungranted` is reserved for the
  // e2e specs that read `tenant.ungranted` directly to assert RLS denial.)
  const actors = new Map<string, SeedActor>([
    ['admin', tenant.granted],
    ['viewer', tenant.member],
  ]);
  for (const spec of scenario.actors ?? []) {
    const minted = await deps.mintActor(spec.ref, spec.role ?? 'admin');
    actors.set(spec.ref, minted);
    // Set the actor's own profile display name (own-row RLS update) so the co-member
    // directory (ADR-0020) resolves a real name in the Share people-picker, not a
    // short-id. Authored AS the actor — exactly the path a member would take. The
    // `profiles` row is born WITH the auth user (a synchronous AFTER-INSERT trigger on
    // auth.users seeds user_id + email), so this update reliably hits an existing row —
    // and `email` (the directory's secondary line) is already populated. We assert a row
    // was actually returned (RETURNING via `.select()`): an own-row update that matched
    // NOTHING would otherwise pass silently and regress the directory to a bare short-id.
    if (spec.displayName) {
      const { data, error } = await minted.client
        .from('profiles')
        .update({ display_name: spec.displayName })
        .eq('user_id', minted.userId)
        .select('user_id');
      if (error) {
        throw new Error(
          `${scenario.id} display name "${spec.ref}": ${error.message}`
        );
      }
      if (!data || data.length === 0) {
        throw new Error(
          `${scenario.id} display name "${spec.ref}": profiles row not found for ${minted.userId} — display_name was not set (the co-member directory would render a short-id)`
        );
      }
    }
  }
  const clients = new Map<string, SeedClient>();
  const actor = (ref = 'admin'): SeedActor => {
    const a = actors.get(ref);
    if (!a) throw new Error(`${scenario.id}: unknown actor ref "${ref}"`);
    return a;
  };
  const client = async (ref = 'admin'): Promise<SeedClient> => {
    if (!clients.has(ref)) clients.set(ref, await deps.clientFor(actor(ref)));
    return clients.get(ref)!;
  };
  const db = (ref = 'admin'): SupabaseClient => actor(ref).client;
  const spaceId = tenant.spaceId;
  const adminClient = await client('admin');

  // ── cohorts (scopes) + memberships ──────────────────────────────────────────
  for (const scope of scenario.scopes ?? []) {
    const scopeId = await ensureScope(
      db('admin'),
      spaceId,
      `seed-${scenario.id}-${scope.ref}`,
      scope.name,
      actor('admin').userId
    );
    refs.set(`scope:${scope.ref}`, scopeId);
    for (const memberRef of scope.members ?? []) {
      const { error } = await db('admin')
        .from('scope_memberships')
        .insert({
          scope_id: scopeId,
          user_id: actor(memberRef).userId,
          created_by: actor('admin').userId,
        });
      if (error && error.code !== '23505') {
        throw new Error(`${scenario.id} scope membership: ${error.message}`);
      }
    }
  }

  // ── reporting lines ─────────────────────────────────────────────────────────
  for (const line of scenario.reportingLines ?? []) {
    const { error } = await db('admin')
      .from('reporting_lines')
      .insert({
        space_id: spaceId,
        manager_id: actor(line.manager).userId,
        subordinate_id: actor(line.subordinate).userId,
        created_by: actor('admin').userId,
      });
    if (error && error.code !== '23505') {
      throw new Error(`${scenario.id} reporting line: ${error.message}`);
    }
  }

  // ── tag nodes (deduped by title, owned by the primary actor) ────────────────
  for (const title of collectTagTitles(scenario.tree)) {
    const tagId = await adminClient.createNode(spaceId, 'tag', title);
    refs.set(`tag:${title}`, tagId);
  }

  // ── the resource forest ─────────────────────────────────────────────────────
  for (const node of scenario.tree) {
    await materializeNode(node, undefined);
  }

  async function materializeNode(
    node: SeedNode,
    parentFolderId: string | undefined
  ): Promise<void> {
    const ownerRef = node.owner ?? 'admin';
    const c = await client(ownerRef);
    const owner = actor(ownerRef);

    let nodeId: string;
    const hasWorkflow =
      node.kind === 'text' && (node.status || node.workflowKey);

    if (hasWorkflow) {
      // Status/workflow fields are not exposed by the create endpoints — author
      // the node directly under the owner's RLS client (as the e2e seeders do).
      const { data, error } = await db(ownerRef)
        .from('knowledge_resources')
        .insert({
          space_id: spaceId,
          kind: 'text',
          title: node.title,
          status: node.status ?? 'active',
          workflow_key: node.workflowKey ?? null,
          created_by: owner.userId,
          owner_user_id: owner.userId,
          visibility: node.visibility ?? 'private',
        })
        .select('id')
        .single();
      if (error || !data?.id) {
        throw new Error(
          `${scenario.id} node "${node.title}": ${error?.message}`
        );
      }
      nodeId = data.id;
      if (parentFolderId) await c.contain(spaceId, parentFolderId, nodeId);
    } else if (node.kind === 'text') {
      const created = await c.createDoc(spaceId, node.title, {
        parentFolderId,
        lexicalBody: node.body,
      });
      nodeId = created.nodeId;
      // A new doc's body is born as a draft; publish it so read mode shows it,
      // unless the node opts into staying a draft (to demo the draft state).
      if (!node.draft) await c.publishDoc(spaceId, nodeId);
      // Successive published versions → the reader's version history.
      for (const revision of node.revisions ?? []) {
        await c.saveRevision(spaceId, nodeId, revision);
      }
    } else {
      nodeId = await c.createNode(
        spaceId,
        node.kind,
        node.title,
        parentFolderId
      );
      // A `file`/`video` node with a byte payload becomes REAL through the SAME
      // upload transport the product drives (ADR-0026): authorize the upload under
      // the OWNER's RLS (server-decided path only), upload the bytes to the private
      // `kb-media` bucket at that path under the owner's storage client, then confirm
      // the `kb.resource_media_meta` satellite — NEVER a service-role/direct-SQL insert.
      if ((node.kind === 'file' || node.kind === 'video') && node.media) {
        await uploadNodeMedia(
          scenario.id,
          spaceId,
          node,
          nodeId,
          c,
          db(ownerRef)
        );
      }
    }
    refs.set(node.ref, nodeId);

    if (node.description) await c.describe(spaceId, nodeId, node.description);
    // Floor is only widened from the private default — set it before sharing.
    if (node.visibility && !hasWorkflow) {
      await c.setFloor(nodeId, node.visibility);
    }
    for (const scopeRef of node.scopes ?? []) {
      const scopeId = refs.get(`scope:${scopeRef}`);
      if (!scopeId)
        throw new Error(`${scenario.id}: unknown scope "${scopeRef}"`);
      await c.linkScope(nodeId, scopeId);
    }
    for (const tagTitle of node.tags ?? []) {
      const tagId = refs.get(`tag:${tagTitle}`);
      if (!tagId) throw new Error(`${scenario.id}: tag "${tagTitle}" missing`);
      await c.tag(spaceId, nodeId, { tagId });
    }
    // Per-user grants — share the node with one named member (ADR-0019). The grant
    // is authored by the node's OWNER (owner-sovereign) and widens that actor's read
    // visibility; the grantee must be an active space member (a DB same-space guard).
    for (const granteeRef of node.userGrants ?? []) {
      await c.grantUser(nodeId, actor(granteeRef).userId);
    }
    // Star is per-user — pin it in the OWNER's Starred lens (owner needs progress).
    if (node.starred) await c.star(spaceId, nodeId, true);
    // …and for any explicit actors (e.g. star a doc that another user shared with you).
    for (const ref of node.starredBy ?? []) {
      await (await client(ref)).star(spaceId, nodeId, true);
    }
    // Record opens so the node lands in each actor's "Recent" lens (ADR-0016).
    for (const ref of node.openedBy ?? []) {
      await (await client(ref)).open(spaceId, nodeId);
    }

    if (node.kind === 'folder') {
      for (const child of node.children ?? []) {
        await materializeNode(child, nodeId);
      }
    }
  }

  // ── extra containment / shortcuts / typed edges ─────────────────────────────
  for (const e of scenario.contains ?? []) {
    // The filer defaults to `admin`; a cross-owner filing names a `by` actor that can
    // see BOTH endpoints (the edge RETURNING needs the folder AND the child visible).
    const filer = e.by ? await client(e.by) : adminClient;
    await filer.contain(spaceId, idOf(e.folder), idOf(e.child));
  }
  for (const e of scenario.shortcuts ?? []) {
    await adminClient.shortcut(spaceId, idOf(e.folder), idOf(e.target));
  }
  for (const e of scenario.edges ?? []) {
    const { error } = await db('admin')
      .from('knowledge_edges')
      .insert({
        space_id: spaceId,
        from_id: idOf(e.from),
        to_id: idOf(e.to),
        relation_type: e.relation,
        position: e.position ?? 0,
        created_by: actor('admin').userId,
      });
    if (error)
      throw new Error(`${scenario.id} edge ${e.relation}: ${error.message}`);
  }

  // ── projections ─────────────────────────────────────────────────────────────
  if ((scenario.projections ?? []).some((p) => p.view === 'board')) {
    await ensureBoardViewType(tenant.service);
  }
  for (const p of scenario.projections ?? []) {
    const ownerRef = p.owner ?? 'admin';
    const { data, error } = await db(ownerRef)
      .from('projections')
      .insert({
        space_id: spaceId,
        app_type: p.appType,
        name: p.name,
        view: p.view,
        spec: p.spec(refs),
        created_by: actor(ownerRef).userId,
        owner_user_id: actor(ownerRef).userId,
      })
      .select('id')
      .single();
    if (error || !data?.id) {
      throw new Error(
        `${scenario.id} projection "${p.name}": ${error?.message}`
      );
    }
    refs.set(`projection:${p.ref}`, data.id);
  }

  // ── trash lifecycle demo ────────────────────────────────────────────────────
  for (const ref of scenario.trash ?? []) {
    await adminClient.trash(spaceId, idOf(ref));
  }

  function idOf(ref: string): string {
    const id = refs.get(ref);
    if (!id) throw new Error(`${scenario.id}: unresolved ref "${ref}"`);
    return id;
  }

  return { scenarioId: scenario.id, refs, actors };
}

/**
 * Drive a `file`/`video` node's byte payload through the REAL media transport
 * (ADR-0026, resumable/TUS switch), exactly as the product's create flow does — the seed
 * never inserts a media object or `kmm` row via service-role / direct SQL:
 *   1. authorize the upload (`media?op=upload-url`) under the OWNER's RLS
 *      (`space.knowledge.update`), which returns the SERVER-decided `storagePath` only
 *      (the single-PUT signed-url/token leg was removed with the resumable switch);
 *   2. upload the bytes to the private `kb-media` bucket at that server path under the
 *      OWNER's storage-js client. The PRODUCT uploads via resumable TUS; the seed runs in
 *      Node (no browser `tus-js-client`) with tiny fixtures, so it uses the storage-js
 *      STANDARD `upload(storagePath, bytes, { contentType, upsert:false })` — still fenced
 *      by the SAME `storage.objects` INSERT RLS policy (mirroring node-update), still the
 *      user's own JWT, never service-role;
 *   3. confirm the `kb.resource_media_meta` satellite (`attribute:'media'`) — written
 *      ONLY after a successful upload, so a failure leaves NO row (poc-no-fallbacks).
 * So both the demo tenant and the e2e fixtures get a genuine object + satellite whose
 * access is fenced by the SAME `storage.objects` / satellite RLS as production.
 */
async function uploadNodeMedia(
  scenarioId: string,
  spaceId: string,
  node: BodylessNode,
  nodeId: string,
  client: SeedClient,
  ownerDb: SupabaseClient
): Promise<void> {
  const media = node.media;
  if (!media) return;
  // A binary fixture (image / PDF for the inline preview) carries base64 bytes that
  // must be decoded to the exact binary before the PUT — a UTF-8 re-encode would
  // mangle it and the preview would fail to load. A text fixture is UTF-8 as-is.
  const bytes =
    media.encoding === 'base64'
      ? Uint8Array.from(Buffer.from(media.bytes, 'base64'))
      : new TextEncoder().encode(media.bytes);
  const declared = {
    mimeType: media.mimeType,
    sizeBytes: bytes.byteLength,
    filename: media.filename,
  };

  const authorize = await client.uploadMediaUrl(spaceId, nodeId, declared);
  if (!authorize.storagePath || !authorize.blobId) {
    throw new Error(
      `${scenarioId} media "${node.ref}": upload authorize returned no storagePath/blobId`
    );
  }

  // Upload to the SERVER-decided path under the owner's own session (RLS). The product
  // uses resumable TUS; the seed's tiny fixtures ride the storage-js STANDARD upload —
  // same `storage.objects` INSERT fence, same JWT, no service-role, no `tus-js-client`.
  const { error: uploadError } = await ownerDb.storage
    .from(KB_MEDIA_BUCKET)
    .upload(authorize.storagePath, bytes, {
      contentType: media.mimeType,
      upsert: false,
    });
  if (uploadError) {
    throw new Error(
      `${scenarioId} media "${node.ref}": upload to ${KB_MEDIA_BUCKET} failed — ${uploadError.message}`
    );
  }

  await client.setMedia({
    spaceId,
    nodeId,
    blobId: authorize.blobId,
    originalFilename: media.filename,
  });
}

function collectTagTitles(nodes: SeedNode[]): string[] {
  const titles = new Set<string>();
  const walk = (ns: SeedNode[]): void => {
    for (const n of ns) {
      for (const t of n.tags ?? []) titles.add(t);
      if (n.kind === 'folder') walk(n.children ?? []);
    }
  };
  walk(nodes);
  return [...titles];
}

async function ensureScope(
  adminDb: SupabaseClient,
  spaceId: string,
  key: string,
  name: string,
  createdBy: string
): Promise<string> {
  const ins = await adminDb
    .from('scopes')
    .insert({ space_id: spaceId, key, name, created_by: createdBy })
    .select('id')
    .single();
  if (!ins.error && ins.data?.id) return ins.data.id;
  if (ins.error?.code === '23505') {
    const { data } = await adminDb
      .from('scopes')
      .select('id')
      .eq('space_id', spaceId)
      .eq('key', key)
      .single();
    if (data?.id) return data.id;
  }
  throw new Error(`ensureScope(${key}): ${ins.error?.message ?? 'no id'}`);
}

async function ensureBoardViewType(service: SupabaseClient): Promise<void> {
  const { error } = await service.from('view_types').upsert(
    {
      key: 'board',
      label: 'Board',
      description: 'Status-segmented board view.',
    },
    { onConflict: 'key' }
  );
  if (error) throw new Error(`ensureBoardViewType: ${error.message}`);
}
