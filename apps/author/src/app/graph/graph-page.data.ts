import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import {
  createGraphTranslator,
  loadGraphMessages,
  type GraphTranslator,
} from '@workspace/i18n-catalogs/graph';
import {
  parseProjectionSpec,
  PROJECTION_SPEC_SCHEMA_VERSION,
  type ProjectionResult,
  type ProjectionSpec,
} from '@workspace/knowledge-contracts';
import {
  gateSequence,
  resolveGatingRule,
  resolveProjection,
  type GatedSequence,
  type GatingResult,
} from '@workspace/knowledge-engine';
import { cookies } from 'next/headers';

import {
  createProjectionResolveTransport,
  resolveJwtClaimsFromSession,
} from '@/knowledge/resolve';
import { loadResourceUserStateMap } from '@/knowledge/workflow';
import { kbSchema } from '@/lib/supabase/kb-schema';
import { createRlsClientFromServerCookies } from '@/lib/supabase/rls-from-cookies';

/** One saved projection the user may read (id + display name). */
export type ProjectionOption = {
  id: string;
  name: string;
};

/**
 * Server-side data access for the `/author/graph/*` render pages. Everything here
 * runs under the USER's RLS-scoped client (`createRlsClientFromServerCookies`) —
 * NEVER service-role (ADR-0003 §2). Postgres RLS is the sole access authority: a
 * user without `space.knowledge.read` simply gets no projections / empty items.
 */

const DEFAULT_LOCALE = 'en';

/** Resolve the active space from the canonical cookie the proxy maintains. */
export async function resolveActiveSpaceId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_SPACE_COOKIE)?.value?.trim() || undefined;
}

/**
 * The current user's Supabase id, or `null` for a guest (the proxy redirects
 * guests before render, but the panel degrades gracefully). Used ONLY to label a
 * node's owner as "You" vs another member — there is no RLS-readable identity
 * mirror for arbitrary owner display names in this slice, so the panel shows
 * "You"/"Member" rather than inventing a name (poc-no-fallbacks). RLS is
 * unaffected: this is a display label, never an access decision.
 */
export async function resolveCurrentUserId(): Promise<string | null> {
  const db = await createRlsClientFromServerCookies();
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/** Load the consumer-surface translator (default locale for this POC slice). */
export async function loadGraphTranslator(): Promise<GraphTranslator> {
  const messages = await loadGraphMessages(DEFAULT_LOCALE);
  return createGraphTranslator(messages);
}

/**
 * Load the raw message catalog (default locale) — a plain serializable object.
 * Server pages pass THIS (not the `t` function) to client view components: a
 * function cannot cross the RSC boundary, so the client view rebuilds its own
 * translator from these messages via `createGraphTranslator`.
 */
export async function loadGraphCatalogMessages(): Promise<
  Record<string, string>
> {
  return loadGraphMessages(DEFAULT_LOCALE);
}

/**
 * List the saved projections of the active space the user MAY read (RLS-scoped).
 * No app-level permission check — the `projections` RLS policy keys on
 * `space.knowledge.read`, so an ungranted user receives an empty list natively.
 */
export async function listSpaceProjections(
  spaceId: string
): Promise<ProjectionOption[]> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('projections')
    .select('id,name,app_type')
    .eq('space_id', spaceId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`listSpaceProjections: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Resolve a single saved projection over the graph under the user's RLS session.
 * Returns `null` when the projection row is not visible (RLS) — the page then
 * shows the empty/redirect path rather than leaking existence.
 */
export async function resolveSpaceProjection(args: {
  spaceId: string;
  projectionId: string;
}): Promise<ProjectionResult | null> {
  const db = await createRlsClientFromServerCookies();
  const { data: row, error } = await db
    .from('projections')
    .select('id,spec')
    .eq('space_id', args.spaceId)
    .eq('id', args.projectionId)
    .maybeSingle();
  if (error) {
    throw new Error(`resolveSpaceProjection: ${error.message}`);
  }
  if (!row) {
    return null;
  }

  // Never trust the stored jsonb blindly — validate at the app boundary (zod).
  const parsed = parseProjectionSpec(row.spec);
  if (!parsed.success) {
    throw new Error(
      `resolveSpaceProjection: invalid spec for ${args.projectionId}`
    );
  }

  // ADR-0009: execute the compiled resolve server-side under the user's own RLS
  // context (claims lifted from the SAME session that backs `db`), via the
  // dedicated non-bypass-RLS resolver connection. No raw SQL ever leaves TS.
  const claims = await resolveJwtClaimsFromSession(db);
  return resolveProjection(parsed.data, {
    projectionId: row.id,
    spaceId: args.spaceId,
    db,
    transport: createProjectionResolveTransport(claims),
  });
}

/**
 * The default implicit lens-spec (slice-09 §5.3 / ADR-0012 §5). The product entry
 * `/author/graph` renders the KB editor ALWAYS — at zero resources and with NO
 * saved projection. Rather than redirecting to a saved row (or auto-provisioning
 * one on a GET), the entry resolves this spec built in code:
 *
 *   filter: every content node (`kind in text,link`)
 *   traversal: flat (`max_depth=0`) — the start set IS the result, no walk
 *   view: `lens`
 *
 * `traversal.start.filter` is required by `projectionSpecSchema`; here it mirrors
 * the top-level filter so the start set = all content nodes under the user's RLS.
 * Resolved by the SAME `resolveProjection` with a SYNTHETIC projection id and no
 * `projections` row → zero write on a read path, no chicken-and-egg, no seed.
 * Invariant #1 holds: the editor IS a projection, just the default one. Tag/type
 * facets narrow this flat set client-side (§3.5); a tag-rooted slice is the
 * special case of a saved lens projection (`/author/graph/[projectionId]`).
 */
export const DEFAULT_LENS_PROJECTION_ID = 'default-lens';

export function buildDefaultLensSpec(): ProjectionSpec {
  // The lens canvas is 1:1 with the prototype: it browses ALL resource kinds the
  // graph exposes — folders (container nodes) + every content kind (text/file/
  // video/link). Tag nodes are excluded (they surface in the tag facet, not as
  // canvas cards, exactly like the prototype `contentNodes()` + `folders()`).
  const contentFilter = {
    field: 'kind' as const,
    op: 'in' as const,
    value: ['folder', 'text', 'file', 'video', 'link'],
  };
  return {
    schema_version: PROJECTION_SPEC_SCHEMA_VERSION,
    filter: contentFilter,
    traversal: {
      start: { filter: contentFilter },
      relation_types: [],
      direction: 'outgoing',
      max_depth: 0,
      order_by: 'position',
    },
    view: 'lens',
  };
}

/**
 * Resolve the default implicit lens projection for the active space (§5.3). No
 * `projections` row is read — the spec is built in code (`buildDefaultLensSpec`)
 * and validated at the boundary (zod), then executed under the user's RLS via the
 * landed transport (ADR-0009), never service-role. An ungranted user resolves to
 * `items=[]` — an empty editor, not an error.
 */
export async function resolveDefaultLensProjection(
  spaceId: string
): Promise<ProjectionResult> {
  const spec = buildDefaultLensSpec();
  const parsed = parseProjectionSpec(spec);
  if (!parsed.success) {
    // Built in code from the pinned schema — a failure here is a contract bug.
    throw new Error('resolveDefaultLensProjection: invalid default lens spec');
  }

  const db = await createRlsClientFromServerCookies();
  const claims = await resolveJwtClaimsFromSession(db);
  return resolveProjection(parsed.data, {
    projectionId: DEFAULT_LENS_PROJECTION_ID,
    spaceId,
    db,
    transport: createProjectionResolveTransport(claims),
  });
}

/** One tag node attached to a resource via a `tagged` edge (id + display title). */
export type ResourceTag = {
  id: string; // knr_… of the tag node
  title: string;
};

/**
 * Batch-enrich a set of resource items with their tags (slice-09 §2.4). Tags are
 * `tagged` EDGES (Variant B), never a column — so this is ONE RLS-scoped select
 * over `knowledge_edges` (`from_id in itemIds`, `relation_type='tagged'`) joined
 * to the tag nodes' titles. It deliberately does NOT extend `ProjectionResult`
 * (the contract stays minimal, `schema_version`=1): tags are needed only by the
 * card surfaces (grid/lens), so they ride alongside as a presentation-side
 * loader. Runs under the user's RLS client — tags the user may not read simply
 * do not return (same authority as the resolve). Returns a map keyed by item id.
 */
export async function loadResourceTagsForItems(
  spaceId: string,
  itemIds: string[]
): Promise<Record<string, ResourceTag[]>> {
  const map: Record<string, ResourceTag[]> = {};
  if (itemIds.length === 0) {
    return map;
  }

  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('knowledge_edges')
    .select(
      'from_id,position,to:knowledge_resources!knowledge_edges_to_id_fkey(id,title,kind)'
    )
    .eq('space_id', spaceId)
    .eq('relation_type', 'tagged')
    .in('from_id', itemIds)
    .order('position', { ascending: true });
  if (error) {
    throw new Error(`loadResourceTagsForItems: ${error.message}`);
  }

  for (const row of data ?? []) {
    // PostgREST returns the embedded relation as an object (or null when the
    // joined row is not RLS-visible) — narrow defensively.
    const tag = (row as { to?: { id: string; title: string } | null }).to;
    if (!tag) {
      continue;
    }
    const fromId = (row as { from_id: string }).from_id;
    (map[fromId] ??= []).push({ id: tag.id, title: tag.title });
  }
  return map;
}

/**
 * All tag nodes of a space the user MAY read (slice-11 panel TagEditor tray /
 * ResourcePanel §). The TagEditor's "pick from existing tags" tray toggles the
 * whole space's tag set, so this is ONE RLS-scoped select over
 * `knowledge_resources` (`kind='tag'`) — the SAME pattern as
 * `loadResourceTagsForItems`, never service-role. An ungranted user gets `[]`. The
 * set is small (a space's tag vocabulary), ordered by title for a stable tray.
 */
export async function loadAllSpaceTags(
  spaceId: string
): Promise<ResourceTag[]> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('knowledge_resources')
    .select('id,title')
    .eq('space_id', spaceId)
    .eq('kind', 'tag')
    .order('title', { ascending: true });
  if (error) {
    throw new Error(`loadAllSpaceTags: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: (row as { id: string }).id,
    title: (row as { title: string }).title,
  }));
}

/** A high-connectivity content node proposed as a root of the lens rail. */
export type HubNode = {
  id: string;
  title: string;
  kind: string;
  degree: number;
};

const HUB_DEGREE_THRESHOLD = 2;
const HUB_LIMIT_DEFAULT = 25;

/**
 * Hub-seeding (slice-09 §3.0): the rail has no containment root, so its roots are
 * the highest-connectivity CONTENT nodes. Degree = the count of `relates_to` ⊕
 * `tagged` edges incident on a node (either endpoint), computed under the user's
 * RLS client (edges the user may not read are not counted — RLS is the authority,
 * not the application). Tag nodes are excluded from the rail roots (they surface
 * in the tag facet, §3.5); only `text`/`link` content nodes are hubs.
 *
 * This is a PRESENTATION-side seed (which nodes to offer as entry points), not a
 * domain traversal — so it lives here as a thin RLS-scoped select, not an engine
 * port. `degree ≥ 2`, ordered by degree desc, capped at `limit`. An ungranted
 * user gets an empty list (empty rail), never an error.
 */
export async function loadHubNodes(
  spaceId: string,
  limit: number = HUB_LIMIT_DEFAULT
): Promise<HubNode[]> {
  const db = await createRlsClientFromServerCookies();

  // RLS-visible edges over the two connectivity relations. We compute degree in
  // TS over the returned rows (small demo sets, §0): a node's degree is how many
  // of these edges touch it on either endpoint.
  const { data: edges, error: edgeErr } = await db
    .from('knowledge_edges')
    .select('from_id,to_id')
    .eq('space_id', spaceId)
    .in('relation_type', ['relates_to', 'tagged']);
  if (edgeErr) {
    throw new Error(`loadHubNodes edges: ${edgeErr.message}`);
  }

  const degreeById = new Map<string, number>();
  for (const edge of edges ?? []) {
    const from = (edge as { from_id: string }).from_id;
    const to = (edge as { to_id: string }).to_id;
    degreeById.set(from, (degreeById.get(from) ?? 0) + 1);
    degreeById.set(to, (degreeById.get(to) ?? 0) + 1);
  }

  const candidateIds = [...degreeById.entries()]
    .filter(([, degree]) => degree >= HUB_DEGREE_THRESHOLD)
    .map(([id]) => id);
  if (candidateIds.length === 0) {
    return [];
  }

  // Resolve titles + kinds, keeping only content nodes (tags are facets, not
  // rail roots). RLS narrows again here — a node hidden from the user drops out.
  const { data: nodes, error: nodeErr } = await db
    .from('knowledge_resources')
    .select('id,title,kind')
    .eq('space_id', spaceId)
    .in('id', candidateIds)
    .in('kind', ['text', 'link']);
  if (nodeErr) {
    throw new Error(`loadHubNodes nodes: ${nodeErr.message}`);
  }

  return (nodes ?? [])
    .map((node) => ({
      id: (node as { id: string }).id,
      title: (node as { title: string }).title,
      kind: (node as { kind: string }).kind,
      degree: degreeById.get((node as { id: string }).id) ?? 0,
    }))
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/**
 * Compute per-user course display gating (slice-05 §4.2). A THIN server helper,
 * separate from `resolveSpaceProjection` (which stays projection-PURE): it fetches
 * the caller's overlay state under their RLS-scoped client (own-rows only, never
 * service-role) and overlays it onto the already-resolved course result via the
 * pure `gateSequence` engine function. Call this ONLY when `result.view === 'course'`
 * — grid/KB carries no per-user gating in this slice.
 *
 * Separation held: traversal (resolver) and per-user state (this overlay) are
 * distinct layers, merged at render time — the resolver never learns about
 * `resource_user_state`.
 */
export async function resolveCourseGating(args: {
  spaceId: string;
  result: ProjectionResult;
}): Promise<GatedSequence> {
  const db = await createRlsClientFromServerCookies();
  const state = await loadResourceUserStateMap(args.spaceId, { db });
  return gateSequence(args.result, state);
}

/**
 * Compute per-node display gating for a projection that DECLARES a gating rule
 * (slice-06 §4.2 / §8.B). A THIN server helper, separate from
 * `resolveSpaceProjection` (which stays projection-PURE): it reads the saved
 * `spec.gating` declaration under the caller's RLS-scoped client (never
 * service-role), builds the `resourceStateMap` from the ALREADY-resolved
 * `result.items[].status` (no second graph fetch), resolves the named rule from
 * the engine's registry, and applies it.
 *
 * resource-state gating (e.g. `requires_state`) is DISPLAY only (ADR-0006 §2): a
 * gated node stays in `result.items`; the rule merely computes `available`. RLS
 * remains the sole hard access authority. Returns `null` when the projection has
 * no gating declaration or its rule key is unknown — the view then renders every
 * node as available.
 */
export async function resolveProjectionGating(args: {
  spaceId: string;
  projectionId: string;
  result: ProjectionResult;
}): Promise<GatingResult | null> {
  const db = await createRlsClientFromServerCookies();
  const { data: row, error } = await db
    .from('projections')
    .select('spec')
    .eq('space_id', args.spaceId)
    .eq('id', args.projectionId)
    .maybeSingle();
  if (error) {
    throw new Error(`resolveProjectionGating: ${error.message}`);
  }
  if (!row) {
    return null;
  }

  const parsed = parseProjectionSpec(row.spec);
  if (!parsed.success || !parsed.data.gating) {
    return null;
  }

  const rule = resolveGatingRule(parsed.data.gating.rule);
  if (!rule) {
    return null;
  }

  // resource-state map from the already-resolved items (no second graph fetch).
  const resourceStateMap: Record<string, string> = {};
  for (const item of args.result.items) {
    resourceStateMap[item.id] = item.status;
  }

  return rule(args.result, {
    resourceStateMap,
    params: parsed.data.gating.params,
  });
}

/**
 * One `contains` edge (folder → child) as the lens rail / canvas reads it.
 * `from` is the container folder, `to` the child node (FORWARD per ADR-0015).
 */
export type ContainmentEdge = {
  from: string; // knr_… of the folder
  to: string; // knr_… of the child (folder or content node)
  position: number;
};

/**
 * The whole containment forest of a space (slice-11 Ф2 §2/§4). The lens rail is
 * the prototype's GraphTree rooted at root folders + the canvas browses a folder's
 * children — both walk FORWARD `contains` edges (ADR-0015). The neighborhood
 * engine port is frozen to `relates_to,tagged,part_of` (ADR-0010), so containment
 * is read HERE as a thin RLS-scoped select over `knowledge_edges`
 * (`relation_type='contains'`) — the SAME pattern as `loadResourceTagsForItems`,
 * never a new engine port and never service-role. The set is small (a space's
 * folder tree), so the client builds the tree/breadcrumb/descendant counts over
 * this flat edge list. An ungranted user gets `[]` (RLS) → an empty rail.
 */
export async function loadContainmentForest(
  spaceId: string
): Promise<ContainmentEdge[]> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('knowledge_edges')
    .select('from_id,to_id,position')
    .eq('space_id', spaceId)
    .eq('relation_type', 'contains')
    .order('position', { ascending: true });
  if (error) {
    throw new Error(`loadContainmentForest: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    from: (row as { from_id: string }).from_id,
    to: (row as { to_id: string }).to_id,
    position: (row as { position: number | null }).position ?? 0,
  }));
}

/**
 * One `shortcut` edge (folder → target) as the Drive view reads it (slice-11 Ф3,
 * ADR-0015 §3). FORWARD direction `from`=folder, `to`=target. A cross-folder
 * symlink: rendered ONLY in Drive, EXCLUDED from containment traversal
 * (breadcrumb/counts walk `contains` only), so it never forms a containment cycle.
 */
export type ShortcutEdge = {
  from: string; // knr_… of the source folder
  to: string; // knr_… of the target (folder or content node)
  position: number;
};

/**
 * The whole shortcut forest of a space (slice-11 Ф3 §3.1). Read HERE as a thin
 * RLS-scoped select over `knowledge_edges` (`relation_type='shortcut'`) — the SAME
 * pattern as `loadContainmentForest`, never a new engine port and never
 * service-role. An ungranted user gets `[]` (RLS) → no shortcuts. The set is small
 * (a space's cross-folder symlinks), so the client groups by source folder.
 */
export async function loadShortcutForest(
  spaceId: string
): Promise<ShortcutEdge[]> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('knowledge_edges')
    .select('from_id,to_id,position')
    .eq('space_id', spaceId)
    .eq('relation_type', 'shortcut')
    .order('position', { ascending: true });
  if (error) {
    throw new Error(`loadShortcutForest: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    from: (row as { from_id: string }).from_id,
    to: (row as { to_id: string }).to_id,
    position: (row as { position: number | null }).position ?? 0,
  }));
}

/** KB application attributes of ONE node, as the lens reads them (RLS-scoped). */
export type KbAttributes = {
  /** RAG-bound description text (editable, stored). Absent → never set. */
  description?: string;
  /** Provenance source of the node. Absent → defaults to human in the view. */
  provenance?: 'human' | 'imported' | 'ai';
  /** External URL + host for `kind=link`. */
  link?: { url: string; host: string | null };
  /** File size / video duration / mime for `kind=file|video`. */
  media?: {
    byteSize: number | null;
    durationMs: number | null;
    mimeType: string | null;
  };
  /** Real view counter (server-incremented on open). */
  viewCount?: number;
};

/**
 * Batch-load the KB satellite attributes for a set of nodes (slice-11 Ф2 §7).
 * Each attribute lives in the dedicated `kb` schema keyed by `node_id` (ADR-0013);
 * this is the READ counterpart of `kb-attribute.fanout` — five thin RLS-scoped
 * selects (one per satellite table) over `node_id in itemIds`, merged into a map.
 * It runs under the user's RLS client via `kbSchema(db)`: a satellite the user may
 * not read (because the parent node is hidden) simply does not return — the
 * satellite RLS mirrors the node's access (ADR-0013 §4). It deliberately does NOT
 * extend `ProjectionResult` (contracts frozen, `schema_version`=1) — it rides
 * alongside as a presentation-side fan-out, exactly like the tag loader.
 *
 * embed-status is intentionally NOT read here: it is a RAG seam with no vector
 * pipeline, so the panel never shows an embed indicator (poc-no-fallbacks).
 */
export async function loadKbAttributesForItems(
  spaceId: string,
  itemIds: string[]
): Promise<Record<string, KbAttributes>> {
  const map: Record<string, KbAttributes> = {};
  if (itemIds.length === 0) {
    return map;
  }
  const db = await createRlsClientFromServerCookies();
  const kb = kbSchema(db);
  const ensure = (id: string): KbAttributes => (map[id] ??= {});

  const [descriptions, provenances, links, media, activity] = await Promise.all(
    [
      kb
        .from('resource_description')
        .select('node_id,body')
        .eq('space_id', spaceId)
        .in('node_id', itemIds),
      kb
        .from('resource_provenance')
        .select('node_id,source')
        .eq('space_id', spaceId)
        .in('node_id', itemIds),
      kb
        .from('resource_link')
        .select('node_id,url,host')
        .eq('space_id', spaceId)
        .in('node_id', itemIds),
      kb
        .from('resource_media_meta')
        .select('node_id,byte_size,duration_ms,mime_type')
        .eq('space_id', spaceId)
        .in('node_id', itemIds),
      kb
        .from('resource_activity')
        .select('node_id,view_count')
        .eq('space_id', spaceId)
        .in('node_id', itemIds),
    ]
  );

  for (const result of [descriptions, provenances, links, media, activity]) {
    if (result.error) {
      throw new Error(`loadKbAttributesForItems: ${result.error.message}`);
    }
  }

  for (const row of descriptions.data ?? []) {
    ensure(row.node_id).description = row.body;
  }
  for (const row of provenances.data ?? []) {
    ensure(row.node_id).provenance = row.source;
  }
  for (const row of links.data ?? []) {
    ensure(row.node_id).link = { url: row.url, host: row.host };
  }
  for (const row of media.data ?? []) {
    ensure(row.node_id).media = {
      byteSize: row.byte_size,
      durationMs: row.duration_ms,
      mimeType: row.mime_type,
    };
  }
  for (const row of activity.data ?? []) {
    ensure(row.node_id).viewCount = row.view_count;
  }
  return map;
}

/** Node owner + timestamps the panel meta + health need but the FROZEN
 * `ProjectionResultItem` contract does not carry (`schema_version`=1). Rides
 * alongside as a presentation fan-out, exactly like tags / KB attributes. */
export type NodeMeta = {
  ownerUserId: string | null;
  updatedAt: string;
};

/**
 * Batch-load owner + updated_at for the resolved item set (slice-11 Ф2). The
 * panel shows "owner · updated …" and health needs `updated_at` for staleness —
 * neither is in the frozen result contract, so they ride alongside as a thin
 * RLS-scoped select (same authority as the resolve). Returns a map by node id.
 */
export async function loadNodeMetaForItems(
  spaceId: string,
  itemIds: string[]
): Promise<Record<string, NodeMeta>> {
  const map: Record<string, NodeMeta> = {};
  if (itemIds.length === 0) {
    return map;
  }
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('knowledge_resources')
    .select('id,owner_user_id,updated_at')
    .eq('space_id', spaceId)
    .in('id', itemIds);
  if (error) {
    throw new Error(`loadNodeMetaForItems: ${error.message}`);
  }
  for (const row of data ?? []) {
    map[(row as { id: string }).id] = {
      ownerUserId: (row as { owner_user_id: string | null }).owner_user_id,
      updatedAt: (row as { updated_at: string }).updated_at,
    };
  }
  return map;
}

/** Computed health flags per node (slice-11 Ф2 §3, ADR-0013 §7 — DERIVED, not
 * stored): `orphan` = a content node with zero `relates_to` connectivity edges;
 * `stale` = `updated_at` older than the review threshold. */
export type NodeHealth = { orphan: boolean; stale: boolean };

/** Nodes older than this are flagged "needs review" (presentation threshold). */
const STALE_AFTER_DAYS = 90;

/**
 * Compute orphan/stale health for the resolved item set (slice-11 Ф2 §3). Health
 * is DERIVED (ADR-0013 §7: never materialized — sync risk) from data already read
 * under the user's RLS: orphan = degree 0 over `relates_to` connectivity edges
 * (folders/tags are never orphans — the prototype `isOrphan` excludes them);
 * stale = `updated_at` past the threshold. One thin RLS-scoped edge select for
 * connectivity (the same authority as the resolve), the rest pure computation.
 * Returns a map keyed by node id for client-side facet narrowing (not a
 * re-resolve — §3.5).
 */
export async function computeNodeHealth(
  spaceId: string,
  items: { id: string; kind: string }[],
  metaById: Record<string, NodeMeta>
): Promise<Record<string, NodeHealth>> {
  const map: Record<string, NodeHealth> = {};
  if (items.length === 0) {
    return map;
  }
  const db = await createRlsClientFromServerCookies();
  const { data: edges, error } = await db
    .from('knowledge_edges')
    .select('from_id,to_id')
    .eq('space_id', spaceId)
    .eq('relation_type', 'relates_to');
  if (error) {
    throw new Error(`computeNodeHealth: ${error.message}`);
  }

  const connected = new Set<string>();
  for (const edge of edges ?? []) {
    connected.add((edge as { from_id: string }).from_id);
    connected.add((edge as { to_id: string }).to_id);
  }

  const staleThreshold = Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  for (const item of items) {
    const isContainerOrTag = item.kind === 'folder' || item.kind === 'tag';
    const orphan = !isContainerOrTag && !connected.has(item.id);
    const updatedAt = metaById[item.id]?.updatedAt;
    const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
    const stale = Number.isFinite(updatedMs) && updatedMs < staleThreshold;
    map[item.id] = { orphan, stale };
  }
  return map;
}
