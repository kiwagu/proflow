/**
 * The create-vocabulary, written as ROWS. One method per authoring gesture, each
 * one or two statements against the tables the product itself writes — the seed
 * has no application server to drive, so the schema IS its interface.
 *
 * Identity: writes go through the SERVICE-role client, and every actor-bound
 * column (`created_by`, `owner_user_id`, `linked_by`, `granted_by`, the per-user
 * state key) is set explicitly from the acting `SeedActor`. Reads that exist to
 * model what a participant can see (the share-dialog projection) run on that
 * actor's own RLS-scoped client. Access itself is proven by dedicated e2e specs,
 * never by the seed.
 *
 * Document bodies do NOT live in these tables: a text node's body is a CRDT,
 * stored as a snapshot on `crdt_documents` plus an append-only `crdt_updates`
 * journal, and the node points at it through `body_ref`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DocumentCrdt } from '@workspace/doc-crdt';
import { fromByteaHex, toByteaHex } from '@workspace/doc-sync';
import type { SerializedNode, SerializedTree } from '@workspace/domain';
import { createEntityIdFor } from '@workspace/entity-id';
import type { ResourceStatus } from '@workspace/knowledge-contracts';
import { KB_MEDIA_BUCKET } from '@workspace/knowledge-contracts';
import { MEDIA_DOWNLOAD_URL_TTL_SECONDS } from '@workspace/knowledge-contracts';
import { compareText } from '@workspace/std';

import type { SeedActor } from './types.js';

export type NodeKind = 'folder' | 'link' | 'tag' | 'file' | 'video';
export type Floor = 'private' | 'space' | 'organization';

/** A created text node and the CRDT document holding its body. */
export type TextResourceResult = {
  nodeId: string;
  docId: string;
};

/** Ids a purge actually destroyed (empty = nothing was permitted/visible). */
export type PurgeResult = { purged: string[]; reason?: string };

/** The reserved byte record an upload writes to: the blob-addressed storage path
 * plus the `kb.media_blob` id the media satellite later references. */
export type MediaUploadUrl = {
  storagePath: string;
  blobId: string;
};

/** A short-lived signed download url for a node's media, with its absolute expiry. */
export type MediaDownloadUrl = { signedUrl: string; expiresAt: string };

/** One grantable co-member as the share people-picker reads it. */
export type GrantableMember = {
  userId: string;
  displayName: string;
  email: string | null;
};

/** One per-user grant row as the "who has access" list reads it. */
export type UserGrant = {
  userId: string;
  displayName: string;
  email: string | null;
  grantedBy: string;
};

/** ONE keyset page of the grantable-member picker: real candidates only (the
 * owner and the already-granted are excluded at the source), `total` counting
 * every grantable match, `nextCursor` an opaque token for the next page. */
export type GrantableMembersPage = {
  items: GrantableMember[];
  nextCursor: string | null;
  total: number;
};

/** A node's whole audience: broadcast floor, cohort choices, per-user grants and
 * one page of the grantable people-picker. */
export type Visibility = {
  choices: { id: string; name: string; linked: boolean }[];
  floor: Floor;
  grants: UserGrant[];
  members: GrantableMembersPage;
};

/** How the seed addresses one actor's writes. */
export type SeedClientDeps = {
  /** Service-role client — the writer. */
  service: SupabaseClient;
  /** The acting participant: every actor-bound column is stamped from here. */
  actor: SeedActor;
};

/**
 * The shared create-vocabulary. Method names are the product's authoring
 * gestures, so a scenario reads as a story rather than as SQL.
 */
export type SeedClient = {
  createFolder(
    spaceId: string,
    title: string,
    parentFolderId?: string
  ): Promise<string>;
  createNode(
    spaceId: string,
    kind: NodeKind,
    title: string,
    parentFolderId?: string
  ): Promise<string>;
  createDoc(
    spaceId: string,
    title: string,
    opts?: { parentFolderId?: string; lexicalBody?: unknown }
  ): Promise<TextResourceResult>;
  /** Lift a doc out of `draft` — the body becomes the readable state. */
  publishDoc(spaceId: string, nodeId: string): Promise<void>;
  /** Commit a NEW body state onto the document's CRDT (repeat to build history). */
  saveRevision(
    spaceId: string,
    nodeId: string,
    lexicalBody: unknown
  ): Promise<void>;
  /** Record a per-user "open" → the node lands in this actor's "Recent" lens. */
  open(spaceId: string, nodeId: string): Promise<void>;
  rename(spaceId: string, resourceId: string, title: string): Promise<void>;
  describe(spaceId: string, nodeId: string, body: string): Promise<void>;
  contain(
    spaceId: string,
    folderId: string,
    childId: string,
    position?: number
  ): Promise<void>;
  shortcut(
    spaceId: string,
    folderId: string,
    targetId: string,
    position?: number
  ): Promise<void>;
  tag(
    spaceId: string,
    resourceId: string,
    tag: { tagId?: string; tagTitle?: string }
  ): Promise<{ edgeId: string; tagId: string }>;
  relate(
    spaceId: string,
    fromId: string,
    toId: string,
    position?: number
  ): Promise<void>;
  /** Re-file a node under another folder (or to the root) at a given position. */
  move(
    spaceId: string,
    nodeId: string,
    targetParentId: string | null,
    position?: number
  ): Promise<void>;
  trash(spaceId: string, resourceId: string): Promise<void>;
  restore(spaceId: string, resourceId: string): Promise<void>;
  purge(spaceId: string, resourceId: string): Promise<PurgeResult>;
  setFloor(resourceId: string, visibility: Floor): Promise<void>;
  /** Set the workflow-lifecycle status (`draft` → `active` → `archived`). */
  setStatus(
    spaceId: string,
    resourceId: string,
    status: ResourceStatus
  ): Promise<void>;
  /** Read the node's share audience AS this actor (its own RLS session). */
  visibility(
    spaceId: string,
    nodeId: string,
    opts?: { query?: string; cursor?: string; limit?: number }
  ): Promise<Visibility>;
  linkScope(resourceId: string, scopeId: string): Promise<void>;
  /** Share a resource with ONE person — an additive per-user read grant. */
  grantUser(resourceId: string, userId: string): Promise<void>;
  /** Revoke a per-user grant — symmetric to `grantUser`. */
  revokeUser(resourceId: string, userId: string): Promise<void>;
  star(spaceId: string, nodeId: string, starred: boolean): Promise<void>;
  /** Set a link node's external URL (`kb.resource_link`); http(s) only. */
  setLink(spaceId: string, nodeId: string, url: string): Promise<void>;
  /** Reserve a byte record for a `file`/`video` node and return where to upload. */
  uploadMediaUrl(
    spaceId: string,
    nodeId: string,
    declared: {
      mimeType: string;
      sizeBytes: number;
      filename: string;
      durationMs?: number;
    }
  ): Promise<MediaUploadUrl>;
  /** Point the node at an uploaded blob — written only after the bytes land. */
  setMedia(input: {
    spaceId: string;
    nodeId: string;
    blobId: string;
    originalFilename: string;
  }): Promise<void>;
  /** Mint a short-lived signed download url for the node's media. */
  downloadMediaUrl(spaceId: string, nodeId: string): Promise<MediaDownloadUrl>;
};

/** The `contains`/`shortcut`/`tagged`/`relates_to` edge vocabulary. */
type RelationType = 'contains' | 'shortcut' | 'tagged' | 'relates_to';

function fail(context: string, message: string | undefined): never {
  throw new Error(`${context}: ${message ?? 'no row returned'}`);
}

/** base64url (RFC 4648 §5) — the encoding the opaque picker cursor uses. */
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(token: string): string {
  return Buffer.from(
    token.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
}

/** The keyset position of the previous page's last row: sort key + user id. */
type DirectoryCursor = { k: string; u: string };

function decodeCursor(token: string | undefined): DirectoryCursor | null {
  if (!token || token.trim() === '') return null;
  try {
    const parsed = JSON.parse(fromBase64Url(token.trim())) as Partial<
      Record<'k' | 'u', unknown>
    >;
    return typeof parsed.k === 'string' &&
      typeof parsed.u === 'string' &&
      parsed.u !== ''
      ? { k: parsed.k, u: parsed.u }
      : null;
  } catch {
    return null;
  }
}

/** The picker's default page size; the directory function clamps to ≤50. */
const PICKER_PAGE_SIZE = 5;
const DIRECTORY_LIMIT = 50;

/**
 * A conservative extension taken from a declared filename (letters/digits,
 * max 12). The storage key never trusts the raw filename — traversal and
 * collision safety — so the extension is the only part that survives.
 */
function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? `.${ext}` : '';
}

/**
 * Give every node of a serialized tree a stable id, keyed by its PATH from the
 * root. The CRDT identifies children by id — without one it refuses the commit,
 * and with a positional one every revision would read as "everything replaced"
 * instead of a diff. A seed body has no editor to mint them, so the path does:
 * appending a block leaves its siblings' ids untouched.
 */
function withNodeIds(body: unknown): SerializedTree {
  const input = body as { root?: SerializedNode } | undefined;
  const root = input?.root;
  if (!root || typeof root.type !== 'string') {
    throw new Error('lexical body has no root node');
  }
  const walk = (node: SerializedNode, path: string): SerializedNode => {
    const state = (node.$ ?? {}) as Record<string, unknown>;
    const next: SerializedNode = {
      ...node,
      $: { ...state, id: typeof state.id === 'string' ? state.id : path },
    };
    if (Array.isArray(node.children)) {
      next.children = node.children.map((child, i) =>
        walk(child, `${path}.${i}`)
      );
    }
    return next;
  };
  return { root: walk(root, 'root') };
}

/** Build a `SeedClient` that writes rows on behalf of one actor. */
export function makeSeedClient(deps: SeedClientDeps): SeedClient {
  const { service, actor } = deps;
  const kb = service.schema('kb');

  async function insertNode(
    spaceId: string,
    kind: string,
    title: string,
    extra: Record<string, unknown> = {}
  ): Promise<string> {
    const { data, error } = await service
      .from('knowledge_resources')
      .insert({
        space_id: spaceId,
        kind,
        title,
        created_by: actor.userId,
        owner_user_id: actor.userId,
        ...extra,
      })
      .select('id')
      .single();
    if (error || !data?.id) {
      fail(`createNode(${kind} "${title}")`, error?.message);
    }
    return data.id as string;
  }

  async function insertEdge(
    spaceId: string,
    fromId: string,
    toId: string,
    relationType: RelationType,
    position?: number
  ): Promise<string> {
    const { data, error } = await service
      .from('knowledge_edges')
      .upsert(
        {
          space_id: spaceId,
          from_id: fromId,
          to_id: toId,
          relation_type: relationType,
          position: position ?? 0,
          created_by: actor.userId,
        },
        { onConflict: 'from_id,to_id,relation_type' }
      )
      .select('id')
      .single();
    if (error || !data?.id) {
      fail(`${relationType}(${fromId}→${toId})`, error?.message);
    }
    return data.id as string;
  }

  /** Update columns of one node; a matched-nothing update is a hard failure —
   * a silently skipped write would leave the scenario quietly wrong. */
  async function updateNode(
    context: string,
    spaceId: string,
    resourceId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const { data, error } = await service
      .from('knowledge_resources')
      .update(patch)
      .eq('space_id', spaceId)
      .eq('id', resourceId)
      .select('id');
    if (error) fail(context, error.message);
    if (!data || data.length === 0) fail(context, 'no row matched');
  }

  /** Resolve the CRDT document behind a text node, restored from its stored
   * snapshot plus every journalled update. */
  async function loadDocument(
    context: string,
    spaceId: string,
    nodeId: string
  ): Promise<{ docId: string; crdt: DocumentCrdt }> {
    const { data: node, error: nodeErr } = await service
      .from('knowledge_resources')
      .select('body_ref')
      .eq('space_id', spaceId)
      .eq('id', nodeId)
      .maybeSingle();
    if (nodeErr) fail(context, nodeErr.message);
    const bodyRef = node?.body_ref as { doc_id?: unknown } | null | undefined;
    const docId = typeof bodyRef?.doc_id === 'string' ? bodyRef.doc_id : null;
    if (!docId) fail(context, 'node carries no document reference');

    const { data: doc, error: docErr } = await service
      .from('crdt_documents')
      .select('snapshot, snapshot_seq')
      .eq('id', docId)
      .maybeSingle();
    if (docErr) fail(context, docErr.message);
    if (!doc) fail(context, `document ${docId} is missing`);

    const { data: updates, error: updErr } = await service
      .from('crdt_updates')
      .select('bytes')
      .eq('doc_id', docId)
      .gt('seq', Number(doc.snapshot_seq ?? 0))
      .order('seq', { ascending: true });
    if (updErr) fail(context, updErr.message);

    const journalled: Uint8Array[] = [];
    for (const row of updates ?? []) {
      const bytes = fromByteaHex((row as { bytes: string }).bytes);
      if (bytes) journalled.push(bytes);
    }
    return {
      docId,
      crdt: DocumentCrdt.restore({
        snapshot: fromByteaHex((doc.snapshot as string | null) ?? null),
        updates: journalled,
      }),
    };
  }

  /** Co-member display names for a space, keyed by user id. The directory is a
   * definer function fenced by the caller's own membership, so it is read AS the
   * actor — a non-member legitimately gets nothing. */
  async function directoryLabels(
    spaceId: string
  ): Promise<
    Map<string, { displayName: string | null; email: string | null }>
  > {
    const { data, error } = await actor.client.rpc('space_member_directory', {
      p_space_id: spaceId,
      p_limit: DIRECTORY_LIMIT,
    });
    if (error) fail('directory', error.message);
    const labels = new Map<
      string,
      { displayName: string | null; email: string | null }
    >();
    for (const row of (data ?? []) as {
      user_id: string;
      display_name: string | null;
      email: string | null;
    }[]) {
      labels.set(row.user_id, {
        displayName: row.display_name,
        email: row.email,
      });
    }
    return labels;
  }

  function label(
    userId: string,
    entry: { displayName: string | null; email: string | null } | undefined
  ): string {
    return (
      entry?.displayName?.trim() || entry?.email?.trim() || userId.slice(0, 8)
    );
  }

  return {
    async createFolder(spaceId, title, parentFolderId) {
      return this.createNode(spaceId, 'folder', title, parentFolderId);
    },

    async createNode(spaceId, kind, title, parentFolderId) {
      const nodeId = await insertNode(spaceId, kind, title);
      if (parentFolderId) {
        await insertEdge(spaceId, parentFolderId, nodeId, 'contains');
      }
      return nodeId;
    },

    async createDoc(spaceId, title, opts) {
      // The body is a CRDT from birth: the document row carries a full snapshot
      // (never shallow — it is the only copy of the history) and the node points
      // at it. A doc starts as a draft; `publishDoc` is what makes it readable.
      const docId = createEntityIdFor('document');
      const crdt = DocumentCrdt.create();
      if (opts?.lexicalBody) {
        crdt.commitTree(withNodeIds(opts.lexicalBody), {
          user: actor.userId,
          src: 'human',
        });
      }
      const { error: docErr } = await service.from('crdt_documents').insert({
        id: docId,
        space_id: spaceId,
        snapshot: toByteaHex(crdt.exportSnapshot()),
        created_by: actor.userId,
      });
      if (docErr) fail(`createDoc("${title}")`, docErr.message);

      const nodeId = await insertNode(spaceId, 'text', title, {
        status: 'draft',
        body_ref: { doc_id: docId },
      });
      if (opts?.parentFolderId) {
        await insertEdge(spaceId, opts.parentFolderId, nodeId, 'contains');
      }
      return { nodeId, docId };
    },

    async publishDoc(spaceId, nodeId) {
      await updateNode(`publishDoc(${nodeId})`, spaceId, nodeId, {
        status: 'active',
      });
    },

    async saveRevision(spaceId, nodeId, lexicalBody) {
      // Another committed state of the same document: the delta beyond what the
      // stored history already holds is appended to the journal, so the reader
      // gains a version instead of the body being overwritten.
      const context = `saveRevision(${nodeId})`;
      const { docId, crdt } = await loadDocument(context, spaceId, nodeId);
      const before = crdt.versionBytes();
      const changed = crdt.commitTree(withNodeIds(lexicalBody), {
        user: actor.userId,
        src: 'human',
      });
      if (!changed) return;
      const { error } = await service.from('crdt_updates').insert({
        doc_id: docId,
        bytes: toByteaHex(crdt.exportUpdatesSince(before)),
        writer: `seed:${actor.userId}`,
        created_by: actor.userId,
      });
      if (error) fail(context, error.message);
    },

    async open(spaceId, nodeId) {
      const { error } = await service.from('resource_user_state').upsert(
        {
          user_id: actor.userId,
          resource_id: nodeId,
          space_id: spaceId,
          last_opened_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,resource_id' }
      );
      if (error) fail(`open(${nodeId})`, error.message);
    },

    async rename(spaceId, resourceId, title) {
      await updateNode(`rename(${resourceId})`, spaceId, resourceId, { title });
    },

    async describe(spaceId, nodeId, body) {
      const { error } = await kb.from('resource_description').upsert(
        {
          node_id: nodeId,
          space_id: spaceId,
          body,
          created_by: actor.userId,
        },
        { onConflict: 'node_id' }
      );
      if (error) fail(`describe(${nodeId})`, error.message);
    },

    async setLink(spaceId, nodeId, url) {
      // `host` is the denormalized display host — derived from the validated URL
      // at write time, never a second source of truth.
      const { error } = await kb.from('resource_link').upsert(
        {
          node_id: nodeId,
          space_id: spaceId,
          url,
          host: new URL(url).host,
          created_by: actor.userId,
        },
        { onConflict: 'node_id' }
      );
      if (error) fail(`setLink(${nodeId})`, error.message);
    },

    async contain(spaceId, folderId, childId, position) {
      await insertEdge(spaceId, folderId, childId, 'contains', position);
    },

    async shortcut(spaceId, folderId, targetId, position) {
      await insertEdge(spaceId, folderId, targetId, 'shortcut', position);
    },

    async tag(spaceId, resourceId, tag) {
      let tagId = tag.tagId;
      if (!tagId) {
        if (!tag.tagTitle) {
          fail(`tag(${resourceId})`, 'neither tagId nor tagTitle given');
        }
        const { data, error } = await service
          .from('knowledge_resources')
          .select('id')
          .eq('space_id', spaceId)
          .eq('kind', 'tag')
          .eq('title', tag.tagTitle)
          .maybeSingle();
        if (error) fail(`tag(${resourceId})`, error.message);
        tagId =
          (data?.id as string | undefined) ??
          (await insertNode(spaceId, 'tag', tag.tagTitle));
      }
      const edgeId = await insertEdge(spaceId, resourceId, tagId, 'tagged');
      return { edgeId, tagId };
    },

    async relate(spaceId, fromId, toId, position) {
      await insertEdge(spaceId, fromId, toId, 'relates_to', position);
    },

    async move(spaceId, nodeId, targetParentId, position) {
      const { error } = await service.rpc('move_knowledge_resource', {
        p_space_id: spaceId,
        p_node_id: nodeId,
        p_target_parent_id: targetParentId,
        p_position: position ?? 0,
      });
      if (error) fail(`move(${nodeId})`, error.message);
    },

    async trash(spaceId, resourceId) {
      await updateNode(`trash(${resourceId})`, spaceId, resourceId, {
        deleted_at: new Date().toISOString(),
        trashed_by: actor.userId,
      });
    },

    async restore(spaceId, resourceId) {
      await updateNode(`restore(${resourceId})`, spaceId, resourceId, {
        deleted_at: null,
        trashed_by: null,
      });
    },

    async purge(spaceId, resourceId) {
      const { data, error } = await service
        .from('knowledge_resources')
        .delete()
        .eq('space_id', spaceId)
        .eq('id', resourceId)
        .select('id');
      if (error) fail(`purge(${resourceId})`, error.message);
      return { purged: (data ?? []).map((row) => (row as { id: string }).id) };
    },

    async setFloor(resourceId, visibility) {
      const { data, error } = await service
        .from('knowledge_resources')
        .update({ visibility })
        .eq('id', resourceId)
        .select('id');
      if (error) fail(`setFloor(${resourceId})`, error.message);
      if (!data || data.length === 0) {
        fail(`setFloor(${resourceId})`, 'no row matched');
      }
    },

    async setStatus(spaceId, resourceId, status) {
      await updateNode(
        `setStatus(${resourceId}→${status})`,
        spaceId,
        resourceId,
        { status }
      );
    },

    async visibility(spaceId, nodeId, opts) {
      const db = actor.client;
      const context = `visibility(${nodeId})`;

      const [nodeRes, scopesRes, linksRes, grantsRes] = await Promise.all([
        db
          .from('knowledge_resources')
          .select('visibility, owner_user_id')
          .eq('id', nodeId)
          .maybeSingle(),
        db
          .from('scopes')
          .select('id,name')
          .eq('space_id', spaceId)
          .order('name', { ascending: true }),
        db
          .from('knowledge_resource_scopes')
          .select('scope_id')
          .eq('resource_id', nodeId),
        db
          .from('knowledge_resource_user_grants')
          .select('user_id,granted_by')
          .eq('resource_id', nodeId),
      ]);
      for (const res of [nodeRes, scopesRes, linksRes, grantsRes]) {
        if (res.error) fail(context, res.error.message);
      }

      const linked = new Set(
        (linksRes.data ?? []).map((r) => (r as { scope_id: string }).scope_id)
      );
      const choices = (scopesRes.data ?? []).map((r) => {
        const scope = r as { id: string; name: string };
        return { id: scope.id, name: scope.name, linked: linked.has(scope.id) };
      });

      const grantRows = (grantsRes.data ?? []) as {
        user_id: string;
        granted_by: string;
      }[];
      const labels = await directoryLabels(spaceId);
      const grants: UserGrant[] = grantRows
        .map((row) => ({
          userId: row.user_id,
          displayName: label(row.user_id, labels.get(row.user_id)),
          email: labels.get(row.user_id)?.email ?? null,
          grantedBy: row.granted_by,
        }))
        .sort((a, b) => compareText(a.displayName, b.displayName));

      // The picker shows REAL candidates only: the owner and everyone already
      // granted are excluded at the source, before both the page and the count.
      const exclude = new Set<string>(grantRows.map((row) => row.user_id));
      const owner = (nodeRes.data as { owner_user_id: string | null } | null)
        ?.owner_user_id;
      if (owner) exclude.add(owner);

      const limit = Math.min(
        Math.max(opts?.limit ?? PICKER_PAGE_SIZE, 1),
        DIRECTORY_LIMIT
      );
      const cursor = decodeCursor(opts?.cursor);
      // One row beyond the page answers "is there a next page" honestly, without
      // inferring it from a total that a concurrent change could shift.
      const { data: page, error: pageErr } = await db.rpc(
        'space_member_directory',
        {
          p_space_id: spaceId,
          p_query: opts?.query,
          p_limit: Math.min(limit + 1, DIRECTORY_LIMIT),
          p_after_key: cursor?.k,
          p_after_user: cursor?.u,
          p_exclude: [...exclude],
        }
      );
      if (pageErr) fail(context, pageErr.message);

      const rows = (page ?? []) as {
        user_id: string;
        display_name: string | null;
        email: string | null;
        total_count: number;
      }[];
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows[pageRows.length - 1];
      return {
        choices,
        floor: ((nodeRes.data as { visibility?: Floor } | null)?.visibility ??
          'private') as Floor,
        grants,
        members: {
          items: pageRows.map((row) => ({
            userId: row.user_id,
            displayName: label(row.user_id, {
              displayName: row.display_name,
              email: row.email,
            }),
            email: row.email,
          })),
          nextCursor:
            hasMore && last
              ? toBase64Url(
                  JSON.stringify({
                    k: last.display_name?.trim() || last.email || '',
                    u: last.user_id,
                  })
                )
              : null,
          total,
        },
      };
    },

    async linkScope(resourceId, scopeId) {
      const { error } = await service.from('knowledge_resource_scopes').upsert(
        {
          resource_id: resourceId,
          scope_id: scopeId,
          linked_by: actor.userId,
        },
        { onConflict: 'resource_id,scope_id' }
      );
      if (error) fail(`linkScope(${resourceId})`, error.message);
    },

    async grantUser(resourceId, userId) {
      const { error } = await service
        .from('knowledge_resource_user_grants')
        .upsert(
          {
            resource_id: resourceId,
            user_id: userId,
            granted_by: actor.userId,
          },
          { onConflict: 'resource_id,user_id' }
        );
      if (error) fail(`grantUser(${resourceId}→${userId})`, error.message);
    },

    async revokeUser(resourceId, userId) {
      const { error } = await service
        .from('knowledge_resource_user_grants')
        .delete()
        .eq('resource_id', resourceId)
        .eq('user_id', userId);
      if (error) fail(`revokeUser(${resourceId}→${userId})`, error.message);
    },

    async star(spaceId, nodeId, starred) {
      const { error } = await service.from('resource_user_state').upsert(
        {
          user_id: actor.userId,
          resource_id: nodeId,
          space_id: spaceId,
          starred,
        },
        { onConflict: 'user_id,resource_id' }
      );
      if (error) fail(`star(${nodeId})`, error.message);
    },

    async uploadMediaUrl(spaceId, nodeId, declared) {
      // The byte record must exist BEFORE the bytes: the storage policy only
      // admits an upload into the uploader's own unreferenced reservation, and
      // the path is addressed by the blob id, so the id is minted here. The
      // object key is server-chosen — the declared filename is display metadata
      // and only ever contributes a conservative extension.
      const blobId = createEntityIdFor('kbMediaBlob');
      const storagePath = `spaces/${spaceId}/kb/blobs/${blobId}/${crypto.randomUUID()}${safeExtension(declared.filename)}`;
      const { error } = await kb.from('media_blob').insert({
        id: blobId,
        space_id: spaceId,
        storage_path: storagePath,
        mime_type: declared.mimeType,
        size_bytes: declared.sizeBytes,
        duration_ms: declared.durationMs ?? null,
        provenance_author_id: actor.userId,
        uploaded_by: actor.userId,
      });
      if (error) fail(`uploadMediaUrl(${nodeId})`, error.message);
      return { storagePath, blobId };
    },

    async setMedia(input) {
      const { error } = await kb.from('resource_media_meta').upsert(
        {
          node_id: input.nodeId,
          space_id: input.spaceId,
          blob_id: input.blobId,
          original_filename: input.originalFilename,
          created_by: actor.userId,
        },
        { onConflict: 'node_id' }
      );
      if (error) fail(`setMedia(${input.nodeId})`, error.message);
    },

    async downloadMediaUrl(spaceId, nodeId) {
      const context = `downloadMediaUrl(${nodeId})`;
      const { data: meta, error: metaErr } = await kb
        .from('resource_media_meta')
        .select('blob_id')
        .eq('node_id', nodeId)
        .eq('space_id', spaceId)
        .maybeSingle();
      if (metaErr) fail(context, metaErr.message);
      if (!meta?.blob_id) fail(context, 'node has no media');

      const { data: blob, error: blobErr } = await kb
        .from('media_blob')
        .select('storage_path,storage_bucket')
        .eq('id', meta.blob_id)
        .maybeSingle();
      if (blobErr) fail(context, blobErr.message);
      if (!blob?.storage_path) fail(context, 'blob is missing');

      // Signed AS the actor: the storage policy is what decides whether this
      // participant may read the bytes at all.
      const { data: signed, error: signErr } = await actor.client.storage
        .from((blob.storage_bucket as string) ?? KB_MEDIA_BUCKET)
        .createSignedUrl(
          blob.storage_path as string,
          MEDIA_DOWNLOAD_URL_TTL_SECONDS
        );
      if (signErr || !signed?.signedUrl) {
        fail(context, signErr?.message ?? 'no signed url');
      }
      return {
        signedUrl: signed.signedUrl,
        expiresAt: new Date(
          Date.now() + MEDIA_DOWNLOAD_URL_TTL_SECONDS * 1000
        ).toISOString(),
      };
    },
  };
}
