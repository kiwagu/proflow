import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import {
  parseProjectionSpec,
  PROJECTION_SPEC_SCHEMA_VERSION,
  type ProjectionResult,
  type ProjectionSpec,
} from '@workspace/knowledge-contracts';
import { resolveProjection } from '@workspace/knowledge-engine';
import { PLATFORM_ENTITLEMENT_SETTING_KEYS } from '@workspace/settings-runtime';
import { byText } from '@workspace/ui/lib/sort';
import { cookies } from 'next/headers';
import { z } from 'zod';

import {
  annotateShareMechanism,
  listResourcesSharedByMe,
} from '@/knowledge/fanout';
import { resolveMediaMaxUploadBytes } from '@/knowledge/media/media-limit.resolve';
import {
  createProjectionResolveTransport,
  resolveJwtClaimsFromSession,
} from '@/knowledge/resolve';
import { kbSchema } from '@workspace/db/kb-schema';
import { createRlsClientFromServerCookies } from '@/lib/supabase/rls-from-cookies';

import type {
  ContainmentEdge,
  KbAttributes,
  NodeMeta,
  ResourceFloor,
  ResourceTag,
  SharedByMeEntry,
  ShareMechanismByItem,
  ShortcutEdge,
  SpaceCapabilities,
  SpaceEntitlements,
} from '@/app/graph/graph-data.types';

/**
 * Server-side data access for the `/author/graph/*` render pages. Everything here
 * runs under the USER's RLS-scoped client (`createRlsClientFromServerCookies`) —
 * NEVER service-role. Postgres RLS is the sole access authority: a
 * user without `space.knowledge.read` resolves to an empty editor, never an error.
 */

/**
 * Run an `.in(column, ids)` ride-alongside select in fixed-size batches, merging
 * the per-batch rows. PostgREST encodes `.in(col, ids)` as a GET query string
 * (`col=in.(id1,id2,…)`); a large resolved set overflows the Supabase REST gateway
 * (Kong/nginx) URL/buffer limit (~4 KB) and the gateway returns an HTML 502 Bad
 * Gateway (not a Postgres error), which surfaces as a thrown error and crashes the
 * whole RSC page. Chunking at 50 ids (≈ ≤2 KB URL with these ~25–30-char entity
 * ids) keeps every request URL comfortably under that limit, with margin.
 *
 * `runBatch` receives one slice of `ids` and returns its rows; the caller's single
 * RLS client (created once, reused across chunks) is closed over by `runBatch`.
 */
const IN_CHUNK_SIZE = 50;

async function inChunks<Row>(
  ids: string[],
  runBatch: (chunk: string[]) => Promise<Row[]>
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CHUNK_SIZE);
    rows.push(...(await runBatch(chunk)));
  }
  return rows;
}

/** Resolve the active space from the canonical cookie the proxy maintains. */
export async function resolveActiveSpaceId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_SPACE_COOKIE)?.value?.trim() || undefined;
}

/** The cookie the Drive grid/list toggle persists (a per-device UI preference). */
export const DRIVE_LAYOUT_COOKIE = 'drive-layout';

/**
 * Resolve the persisted Drive layout (grid/list) from its cookie, SERVER-SIDE, so
 * the SSR'd HTML already renders the chosen layout — no post-hydration flip/flash
 * (the reason a cookie beats localStorage for an SSR-affecting view preference).
 */
export async function resolveDriveLayout(): Promise<'grid' | 'list'> {
  const cookieStore = await cookies();
  return cookieStore.get(DRIVE_LAYOUT_COOKIE)?.value === 'list'
    ? 'list'
    : 'grid';
}

/**
 * The cookie the structural-lens Flat/Advanced toggle persists — a per-device UI preference, mirroring `DRIVE_LAYOUT_COOKIE`. Lens-
 * agnostic (one cookie across all structural lenses). Only ever written on the ENTITLED
 * (Pro) plan: a locked plan never persists 'advanced' (the toggle is disabled and the
 * server clamps the effective mode to 'flat' regardless). A stale legacy `shared-view`
 * cookie is simply ignored (this reads only `lens-view`), so it fail-safes to flat.
 */
export const LENS_VIEW_COOKIE = 'lens-view';

/**
 * Resolve the persisted lens display mode (flat/advanced) from its cookie, SERVER-SIDE,
 * so the SSR'd HTML already renders the remembered mode — no post-hydration flip (the
 * same reason a cookie beats localStorage for an SSR-affecting view preference). Default
 * 'flat'. This is the REMEMBERED preference; an explicit `?view=` in the URL WINS over it
 * (a shareable deep-link override) and the entitlement clamps the final effective mode —
 * both applied by the caller (`page.tsx`).
 */
export async function resolveLensView(): Promise<'flat' | 'advanced'> {
  const cookieStore = await cookies();
  return cookieStore.get(LENS_VIEW_COOKIE)?.value === 'advanced'
    ? 'advanced'
    : 'flat';
}

/**
 * The current user's Supabase id, or `null` for a guest. Used ONLY to label a
 * node's owner as "You" vs another member — a display label, never an access
 * decision; RLS is unaffected.
 */
export async function resolveCurrentUserId(): Promise<string | null> {
  const db = await createRlsClientFromServerCookies();
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * The CURRENT user's space-level knowledge verbs (`update`/`delete`/`create`) for
 * the active space, resolved ONCE here server-side under the user's RLS client —
 * the verdict is constant across every node in the space, so the `⋯` menu combines
 * it with per-node ownership client-side (zero per-node round-trips, zero client-side
 * access re-derivation). Used PURELY to display-gate the menu — RLS stays
 * the sole authority; this only spares the user silent no-op route hits.
 *
 * It calls `auth_user_can_access_in_space(space_id, verb)` — the EXACT predicate the
 * `knowledge_resources` update/delete and insert RLS policies use (membership AND the
 * verb), under the user's session (never service-role). The standalone `hasPermission`
 * helper is deliberately NOT used: it calls `auth_user_has_permission` directly and
 * omits the `auth_user_active_in_space` half of `auth_user_can_access_in_space`, so it
 * would NOT mirror the policy exactly. Any RPC error denies (fail-closed).
 */
export async function resolveSpaceCapabilities(
  spaceId: string
): Promise<SpaceCapabilities> {
  const db = await createRlsClientFromServerCookies();
  const can = async (verb: string): Promise<boolean> => {
    const { data, error } = await db.rpc('auth_user_can_access_in_space', {
      p_space_id: spaceId,
      p_permission_key: verb,
    });
    if (error) {
      // Fail-closed: an unresolved verb hides the gated item (the route would
      // no-op under RLS anyway). RLS is the authority, not this hint.
      return false;
    }
    return data === true;
  };
  const [canUpdate, canDelete, canCreate, canAccess] = await Promise.all([
    can('space.knowledge.update'),
    can('space.knowledge.delete'),
    can('space.knowledge.create'),
    // The audience-management verb — the non-owner
    // half of `canShare`. Mirrors the per-user grant & cohort INSERT/DELETE RLS.
    can('space.knowledge.access'),
  ]);
  return { canUpdate, canDelete, canCreate, canAccess };
}

/**
 * The zod boundary contract for the entitlement resolve (zod-schema-first). The
 * `rpc_resolve_platform_flag` RPC returns a bare boolean (non-sensitive plan state);
 * we parse it into `{ advancedStructuralView }` so the commercial signal crosses the
 * boundary as a validated shape, never a loose primitive.
 */
const SPACE_ENTITLEMENTS_SCHEMA = z.object({
  advancedStructuralView: z.boolean(),
});

/**
 * The CURRENT space's COMMERCIAL entitlements — resolved ONCE here
 * server-side under the user's RLS client, the EXACT parity of how
 * `resolveSpaceCapabilities` calls its predicate (`auth_user_can_access_in_space`).
 * It calls the platform `rpc_resolve_platform_flag` read-RPC (Wave 1, SECURITY
 * DEFINER, granted to `authenticated`) which performs the global→org→space hierarchy
 * with the org∧space AND-composition IN SQL and returns ONE boolean — ZERO
 * service-role on this read path (the RPC reads three scoped `runtime_settings` config
 * rows, never knowledge-resource data, never PII).
 *
 * An entitlement is a DIFFERENT authority from the RLS verbs `resolveSpaceCapabilities`
 * resolves (commercial plan, not permission) — so it is kept ORTHOGONAL, packed as a
 * SIBLING of `capabilities` on `KbViewData` (Fork 1), never merged. Any RPC error
 * fails CLOSED to `false` (fail-to-cheapest-plan, parity with the verb resolve's
 * fail-closed `:121-124`): the toggle locks, the structural lenses render flat. This is
 * a DISPLAY gate only — RLS shows exactly the same node-set either way (Fork 2).
 */
export async function resolveSpaceEntitlements(
  spaceId: string
): Promise<SpaceEntitlements> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db.rpc('rpc_resolve_platform_flag', {
    p_key: PLATFORM_ENTITLEMENT_SETTING_KEYS.advanced_structural_view,
    p_space_id: spaceId,
  });
  if (error) {
    // Fail-closed to the cheapest plan: an unresolved entitlement locks the toggle
    // and forces the flat render. The entitlement is never an access fence (RLS is
    // the sole data authority), so a false-here only withholds a display affordance.
    return { advancedStructuralView: false };
  }
  return SPACE_ENTITLEMENTS_SCHEMA.parse({
    advancedStructuralView: data === true,
  });
}

/**
 * The default implicit lens-spec. The product entry `/author/graph`
 * renders the KB editor ALWAYS — at zero resources and with NO saved projection.
 * The entry resolves this spec built in code:
 *
 *   filter: every content node + folders (`kind in folder,text,file,video,link`)
 *   traversal: flat (`max_depth=0`) — the start set IS the result, no walk
 *   view: `lens`
 *
 * Resolved by the SAME `resolveProjection` with a SYNTHETIC projection id and no
 * `projections` row → zero write on a read path. Invariant #1 holds: the editor IS
 * a projection, just the default one.
 */
export const DEFAULT_LENS_PROJECTION_ID = 'default-lens';

export function buildDefaultLensSpec(): ProjectionSpec {
  // Browses ALL resource kinds the graph exposes — folders (container nodes) +
  // every content kind (text/file/video/link). Tag nodes are excluded (they
  // surface in the tag facet, not as canvas cards).
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
 * The lifecycle lens selector. Trash is a THIRD axis
 * (existence), orthogonal to access (RLS) and workflow (status): the same RLS
 * verdict, the same user, sees a node in ONE lens and not the other. So the
 * trashed/normal split is a query lens, NOT an access fence — the engine /
 * `ProjectionSpec` contract stays frozen (`schema_version`=1, Invariant #1), and
 * this `deleted_at` filter rides as a thin POST-RESOLVE loader filter, never an
 * engine DDL change. It can never leak: it only ever narrows the user's already-
 * accessible set (a direct-PostgREST bypass sees exactly their own accessible
 * trashed rows — which is what the Trash lens shows anyway).
 *
 *   - 'live'    — normal browse: `deleted_at IS NULL` (the default everywhere);
 *   - 'trashed' — the Trash lens: `deleted_at IS NOT NULL`.
 */
export type LifecycleScope = 'live' | 'trashed';

/**
 * Resolve the default implicit lens projection for the active space. No
 * `projections` row is read — the spec is built in code and validated at the
 * boundary (zod), then executed under the user's RLS via the landed transport,
 * never service-role. An ungranted user resolves to `items=[]`.
 *
 * The lifecycle `scope` is applied as a thin POST-RESOLVE filter over
 * the resolved items — the engine resolves the RLS-allowed set (trashed or not),
 * then this narrows to the requested existence lens. Zero engine DDL: the frozen
 * `ProjectionSpec` cannot express `deleted_at`, so the split lives here, not in
 * the compiled SQL. Normal browse (`live`) excludes trashed; the Trash lens
 * (`trashed`) shows only trashed.
 */
export async function resolveDefaultLensProjection(
  spaceId: string,
  scope: LifecycleScope = 'live'
): Promise<ProjectionResult> {
  const spec = buildDefaultLensSpec();
  const parsed = parseProjectionSpec(spec);
  if (!parsed.success) {
    // Built in code from the pinned schema — a failure here is a contract bug.
    throw new Error('resolveDefaultLensProjection: invalid default lens spec');
  }

  const db = await createRlsClientFromServerCookies();
  const claims = await resolveJwtClaimsFromSession(db);
  const result = await resolveProjection(parsed.data, {
    projectionId: DEFAULT_LENS_PROJECTION_ID,
    spaceId,
    db,
    transport: createProjectionResolveTransport(claims),
  });

  // Apply the lifecycle lens. Resolve the deleted_at state of the resolved ids
  // under the user's RLS (same authority as the resolve), then keep only the ids
  // matching the requested existence scope.
  const live = await loadLiveIds(
    spaceId,
    result.items.map((item) => item.id)
  );
  const items = result.items.filter((item) =>
    scope === 'live' ? live.has(item.id) : !live.has(item.id)
  );
  return { ...result, items };
}

/**
 * The subset of `itemIds` that are LIVE (`deleted_at IS NULL`) in this space,
 * read under the user's RLS. The complement (returned ids minus this set) are the
 * trashed ones. A thin select used by the lifecycle lens split.
 */
async function loadLiveIds(
  spaceId: string,
  itemIds: string[]
): Promise<Set<string>> {
  if (itemIds.length === 0) {
    return new Set();
  }
  const db = await createRlsClientFromServerCookies();
  // Chunked to keep each `.in('id', …)` request URL under the REST gateway limit
  // (see `inChunks` — prevents the 502 Bad Gateway on large spaces).
  const rows = await inChunks(itemIds, async (chunk) => {
    const { data, error } = await db
      .from('knowledge_resources')
      .select('id')
      .eq('space_id', spaceId)
      .in('id', chunk)
      .is('deleted_at', null);
    if (error) {
      throw new Error(`loadLiveIds: ${error.message}`);
    }
    return data ?? [];
  });
  return new Set(rows.map((row) => (row as { id: string }).id));
}

/**
 * The whole containment forest of a space. The Drive folder tree / breadcrumb /
 * counts walk FORWARD `contains` edges, read HERE as a thin RLS-scoped
 * select over `knowledge_edges` (`relation_type='contains'`) — never a new engine
 * port and never service-role. An ungranted user gets `[]` (RLS) → an empty Drive.
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
 * The whole shortcut forest of a space. Read as a thin RLS-scoped
 * select over `knowledge_edges` (`relation_type='shortcut'`) — the SAME pattern as
 * `loadContainmentForest`. An ungranted user gets `[]` (RLS) → no shortcuts.
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

/**
 * All tag nodes (`kind='tag'`) of a space — the "vocabulary"
 * of the space, read as a thin RLS-scoped select over `knowledge_resources`. A tag
 * is an ORDINARY node, so it rides the SAME row policy as any resource: an ungranted
 * user gets `[]` (RLS), and a private tag someone else owns simply does not return.
 * Drives the ResourcePanel "pick from existing tags" tray AND the lens tag facet
 * (both space-global by construction — no separate tag-visibility model).
 * Sorted by title with the canonical text sorter so the tray/facet order is stable.
 */
export async function loadSpaceTags(spaceId: string): Promise<ResourceTag[]> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('knowledge_resources')
    .select('id,title')
    .eq('space_id', spaceId)
    .eq('kind', 'tag')
    .is('deleted_at', null);
  if (error) {
    throw new Error(`loadSpaceTags: ${error.message}`);
  }
  return (data ?? [])
    .map((row) => ({
      id: (row as { id: string }).id,
      title: (row as { title: string }).title,
    }))
    .sort(byText((tag) => tag.title));
}

/**
 * Batch-load the tags OF a set of nodes — for each item, the
 * `kind='tag'` nodes it points at via a FORWARD `tagged` edge (from=item → to=tag).
 * Two thin RLS-scoped reads, chunked like `loadKbAttributesForItems`: (1) the
 * `tagged` edges whose `from_id` is in the item set, then (2) the titles of the
 * referenced tag nodes. A tag whose node is RLS-hidden or trashed simply drops out
 * (its title read returns nothing) — the projection can only ever narrow, never leak.
 * Feeds the Drive card tag chips, the ResourcePanel tag section, and the client-side
 * tag-facet filter. A node with no `tagged` edge carries no entry (absent → no tags,
 * poc-no-fallbacks). Per-item lists sorted by tag title (canonical sorter).
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
  // (1) the `tagged` edges of the item set — from_id = tagged resource, to_id = tag
  // node. Chunked to keep each `.in('from_id', …)` URL under the
  // REST gateway limit (see `inChunks`).
  const edges = await inChunks(itemIds, async (chunk) => {
    const { data, error } = await db
      .from('knowledge_edges')
      .select('from_id,to_id')
      .eq('space_id', spaceId)
      .eq('relation_type', 'tagged')
      .in('from_id', chunk);
    if (error) {
      throw new Error(`loadResourceTagsForItems (edges): ${error.message}`);
    }
    return data ?? [];
  });
  const tagIds = [
    ...new Set(edges.map((row) => (row as { to_id: string }).to_id)),
  ];
  if (tagIds.length === 0) {
    return map;
  }
  // (2) the titles of the referenced tag nodes — a live `kind='tag'` row read under
  // the same RLS client (a hidden/trashed tag returns nothing → its edges drop).
  const tagRows = await inChunks(tagIds, async (chunk) => {
    const { data, error } = await db
      .from('knowledge_resources')
      .select('id,title')
      .eq('space_id', spaceId)
      .eq('kind', 'tag')
      .in('id', chunk)
      .is('deleted_at', null);
    if (error) {
      throw new Error(`loadResourceTagsForItems (titles): ${error.message}`);
    }
    return data ?? [];
  });
  const titleById = new Map(
    tagRows.map((row) => [
      (row as { id: string }).id,
      (row as { title: string }).title,
    ])
  );
  for (const row of edges) {
    const { from_id, to_id } = row as { from_id: string; to_id: string };
    const title = titleById.get(to_id);
    if (title === undefined) {
      continue; // RLS-hidden / trashed tag → not readable, drop the edge.
    }
    (map[from_id] ??= []).push({ id: to_id, title });
  }
  for (const id of Object.keys(map)) {
    map[id]!.sort(byText((tag) => tag.title));
  }
  return map;
}

/**
 * Batch-load the KB satellite attributes for a set of nodes. Each
 * attribute lives in the dedicated `kb` schema keyed by `node_id`, read under the
 * user's RLS via `kbSchema(db)` (a satellite the user may not read because the
 * parent node is hidden simply does not return — the satellite RLS mirrors node
 * access). Reads the `description`, `link` (slice-10 §2.4) and `media`
 * satellites; each rides
 * alongside the resolved canvas, never extending the frozen `ProjectionResult`
 * contract. A node with no satellite row simply carries no attribute (empty/absent
 * → no field, NOT a mock — poc-no-fallbacks).
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
  // Chunked to keep each `.in('node_id', …)` request URL under the REST gateway
  // limit (see `inChunks` — prevents the 502 Bad Gateway on large spaces).
  const descriptionRows = await inChunks(itemIds, async (chunk) => {
    const { data, error } = await kbSchema(db)
      .from('resource_description')
      .select('node_id,body')
      .eq('space_id', spaceId)
      .in('node_id', chunk);
    if (error) {
      throw new Error(`loadKbAttributesForItems: ${error.message}`);
    }
    return data ?? [];
  });
  for (const row of descriptionRows) {
    (map[row.node_id] ??= {}).description = row.body;
  }

  // The link satellite (slice-10 §2.4) — same shape as the description read. A
  // `krl` row means the link node has a real URL; its absence means the node is a
  // bare shell (no `link` field, poc-no-fallbacks). The card meta line shows
  // `host`; the ResourcePanel Link section shows/edits `url` and opens it.
  const linkRows = await inChunks(itemIds, async (chunk) => {
    const { data, error } = await kbSchema(db)
      .from('resource_link')
      .select('node_id,url,host')
      .eq('space_id', spaceId)
      .in('node_id', chunk);
    if (error) {
      throw new Error(`loadKbAttributesForItems (link): ${error.message}`);
    }
    return data ?? [];
  });
  for (const row of linkRows) {
    (map[row.node_id] ??= {}).link = { url: row.url, host: row.host };
  }

  // The media satellite — MIRRORS the description read above (same RLS
  // client, same `.in('node_id', chunk)`, same `kb` accessor). A `kmm` row means the
  // node has confirmed bytes; its absence means none (no `media` field, poc-no-
  // fallbacks). The card meta line reads size/duration/mime; the ResourcePanel Media
  // section additionally reads `storagePath` (echoed on download-authorize) +
  // `originalFilename` (display only). The bytes themselves egress ONLY via the
  // server-authorized signed URL — never a public URL, never read here.
  const mediaRows = await inChunks(itemIds, async (chunk) => {
    const { data, error } = await kbSchema(db)
      .from('resource_media_meta')
      .select('node_id,blob_id,original_filename')
      .eq('space_id', spaceId)
      .in('node_id', chunk);
    if (error) {
      throw new Error(`loadKbAttributesForItems (media): ${error.message}`);
    }
    return data ?? [];
  });

  // Resolve the SHARED blobs the references point at: byte-intrinsic
  // fields (size/mime/duration/path) live on `kb.media_blob`, one row per blob no
  // matter how many nodes share it. Same RLS client — the blob SELECT policy
  // grants any holder of a readable reference.
  const blobIds = [...new Set(mediaRows.map((row) => row.blob_id))];
  const blobRows = await inChunks(blobIds, async (chunk) => {
    const { data, error } = await kbSchema(db)
      .from('media_blob')
      .select('id,storage_path,mime_type,size_bytes,duration_ms')
      .in('id', chunk);
    if (error) {
      throw new Error(`loadKbAttributesForItems (blob): ${error.message}`);
    }
    return data ?? [];
  });
  const blobById = new Map(blobRows.map((blob) => [blob.id, blob]));

  for (const row of mediaRows) {
    const blob = blobById.get(row.blob_id);
    if (!blob) {
      continue; // reference without a readable blob — fail-closed, no attribute
    }
    (map[row.node_id] ??= {}).media = {
      byteSize: blob.size_bytes,
      durationMs: blob.duration_ms,
      mimeType: blob.mime_type,
      storagePath: blob.storage_path,
      originalFilename: row.original_filename,
    };
  }
  return map;
}

/**
 * Batch-load owner + last-modified for the resolved item set. The Drive meta line
 * shows "{kind} · {owner}" and the "Modified" column reads `last_modified_at` — the
 * EDIT recency roll-up (node + body + satellite + edge, EXCLUDING opens),
 * so a document BODY edit (which never touches the node row's `updated_at`) is
 * reflected. Neither field is in the frozen result contract, so they ride alongside
 * as a thin RLS-scoped select (same authority as the resolve).
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
  // Chunked to keep each `.in('id', …)` request URL under the REST gateway limit
  // (see `inChunks` — prevents the 502 Bad Gateway on large spaces).
  const rows = await inChunks(itemIds, async (chunk) => {
    const { data, error } = await db
      .from('knowledge_resources')
      .select('id,owner_user_id,last_modified_at,visibility')
      .eq('space_id', spaceId)
      .in('id', chunk);
    if (error) {
      throw new Error(`loadNodeMetaForItems: ${error.message}`);
    }
    return data ?? [];
  });
  for (const row of rows) {
    map[(row as { id: string }).id] = {
      ownerUserId: (row as { owner_user_id: string | null }).owner_user_id,
      lastModifiedAt: (row as { last_modified_at: string }).last_modified_at,
      visibility: (row as { visibility: ResourceFloor }).visibility,
    };
  }
  return map;
}

/**
 * Batch-load the CURRENT user's "last opened by me" timestamps (per-user state,
 * own rows under RLS) for the space. Drives the "Recent" filter — recently VIEWED
 * by me — and its "Viewed" column. Maintained by the activity roll-up:
 * a row exists only once the user has opened the resource, so a missing key means
 * "never opened by me". Returns `resource_id → ISO last_opened_at`.
 */
export async function loadOpenedAtForItems(
  spaceId: string
): Promise<Record<string, string>> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('resource_user_state')
    .select('resource_id,last_opened_at')
    .eq('space_id', spaceId)
    .not('last_opened_at', 'is', null);
  if (error) {
    throw new Error(`loadOpenedAtForItems: ${error.message}`);
  }
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const r = row as { resource_id: string; last_opened_at: string | null };
    if (r.last_opened_at) {
      map[r.resource_id] = r.last_opened_at;
    }
  }
  return map;
}

/**
 * The current user's starred resource ids in a space. A thin RLS-scoped select
 * over `resource_user_state` (`starred = true`) — the own-rows select policy
 * already isolates the user, so no `user_id` filter is needed here. Uses the
 * partial `(user_id, space_id) where starred` index. An ungranted user gets `[]`.
 */
export async function loadStarredIds(spaceId: string): Promise<string[]> {
  const db = await createRlsClientFromServerCookies();
  const { data, error } = await db
    .from('resource_user_state')
    .select('resource_id')
    .eq('space_id', spaceId)
    .eq('starred', true);
  if (error) {
    throw new Error(`loadStarredIds: ${error.message}`);
  }
  return (data ?? []).map(
    (row) => (row as { resource_id: string }).resource_id
  );
}

/**
 * The "Shared by me" lens seed — the resources the CURRENT user has
 * shared OUT in a space, each with the grantee(s) they granted it to. A thin RLS-scoped
 * wrapper over the `listResourcesSharedByMe` fanout: it reads the per-user grant table
 * (`granted_by = me`) joined to the resources I can still SEE under the node SELECT RLS
 * (the fail-closed fence), grantees labelled via the co-member directory.
 *
 * Rides alongside the live canvas (parity with `trash`/`starredIds`): the view filters
 * the resolved canvas to these ids client-side, so the 'shared-by-me' scope switch needs
 * no server re-navigation. Empty when nothing visible is shared — never an error.
 */
export async function loadSharedByMe(
  spaceId: string
): Promise<SharedByMeEntry[]> {
  const db = await createRlsClientFromServerCookies();
  return listResourcesSharedByMe({ spaceId }, { db });
}

/**
 * The "Shared with me" mechanism annotation seed — a map from each
 * node in the shared set (visible nodes I do NOT own) to the WINNING mechanism that
 * grants ME access: `personal > cohort > broadcast`. A thin RLS-scoped wrapper over the
 * `annotateShareMechanism` fanout (three batched reads, never per-node), seeded
 * server-side alongside the live canvas exactly as `sharedByMe` / `starredIds` are.
 *
 * The input is the SHARED SUBSET, not the whole resolved set — the page already has the
 * resolved item meta (`ownerUserId`) and the current user id, so it computes
 * "visible AND owner ≠ me" here and annotates only those ids (the precise `'shared'`
 * lens input, smaller). The annotation is PURE DISPLAY ENRICHMENT over an already-
 * RLS-admitted set; it never decides visibility. Empty when nothing is shared-with-me.
 */
export async function loadShareMechanism(
  spaceId: string,
  sharedNodeIds: string[]
): Promise<ShareMechanismByItem> {
  if (sharedNodeIds.length === 0) {
    return {};
  }
  const db = await createRlsClientFromServerCookies();
  return annotateShareMechanism({ spaceId, nodeIds: sharedNodeIds }, { db });
}

/**
 * The EFFECTIVE per-org max-upload size (bytes) for media uploads in this space
 * — resolved server-side under the user's RLS via the
 * shared `resolveMediaMaxUploadBytes` (org → global → 200 MB default, clamped to the
 * 5 GB hard cap). Threaded to the client purely so the CreateResource picker can show
 * a friendly "too large (max {size})" hint BEFORE any upload starts. It is a UX hint
 * ONLY — the server authorizer (which re-resolves the same value) + the bucket
 * `file_size_limit` are the real fences (RLS/storage the sole authority).
 * A member reads the public `runtime_settings` row under RLS — NEVER service-role.
 */
export async function resolveMaxUploadBytes(spaceId: string): Promise<number> {
  const db = await createRlsClientFromServerCookies();
  return resolveMediaMaxUploadBytes(db, spaceId);
}
