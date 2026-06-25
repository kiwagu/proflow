import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import {
  parseProjectionSpec,
  PROJECTION_SPEC_SCHEMA_VERSION,
  type ProjectionResult,
  type ProjectionSpec,
} from '@workspace/knowledge-contracts';
import { resolveProjection } from '@workspace/knowledge-engine';
import { cookies } from 'next/headers';

import {
  createProjectionResolveTransport,
  resolveJwtClaimsFromSession,
} from '@/knowledge/resolve';
import { kbSchema } from '@/lib/supabase/kb-schema';
import { createRlsClientFromServerCookies } from '@/lib/supabase/rls-from-cookies';

import type {
  ContainmentEdge,
  KbAttributes,
  NodeMeta,
  ShortcutEdge,
  SpaceCapabilities,
} from '@/app/graph/graph-data.types';

/**
 * Server-side data access for the `/author/graph/*` render pages. Everything here
 * runs under the USER's RLS-scoped client (`createRlsClientFromServerCookies`) —
 * NEVER service-role (ADR-0003 §2). Postgres RLS is the sole access authority: a
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
 * access re-derivation). Used PURELY to display-gate the menu (ADR-0006) — RLS stays
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
  const [canUpdate, canDelete, canCreate] = await Promise.all([
    can('space.knowledge.update'),
    can('space.knowledge.delete'),
    can('space.knowledge.create'),
  ]);
  return { canUpdate, canDelete, canCreate };
}

/**
 * The default implicit lens-spec (ADR-0012 §5). The product entry `/author/graph`
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
 * The lifecycle lens selector (ADR-0018 fork #4). Trash is a THIRD axis
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
 * boundary (zod), then executed under the user's RLS via the landed transport
 * (ADR-0009), never service-role. An ungranted user resolves to `items=[]`.
 *
 * The lifecycle `scope` (ADR-0018) is applied as a thin POST-RESOLVE filter over
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
 * trashed ones. A thin select used by the lifecycle lens split (ADR-0018 fork #4).
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
 * counts walk FORWARD `contains` edges (ADR-0015), read HERE as a thin RLS-scoped
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
 * The whole shortcut forest of a space (ADR-0015 §3). Read as a thin RLS-scoped
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
 * Batch-load the KB satellite attributes for a set of nodes (ADR-0013). Each
 * attribute lives in the dedicated `kb` schema keyed by `node_id`, read under the
 * user's RLS via `kbSchema(db)` (a satellite the user may not read because the
 * parent node is hidden simply does not return — the satellite RLS mirrors node
 * access). Today only `description` is landed; media/link/etc. populate here as
 * their satellites land. Rides alongside the resolved canvas, never extending the
 * frozen `ProjectionResult` contract.
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
  const rows = await inChunks(itemIds, async (chunk) => {
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
  for (const row of rows) {
    (map[row.node_id] ??= {}).description = row.body;
  }
  return map;
}

/**
 * Batch-load owner + last-modified for the resolved item set. The Drive meta line
 * shows "{kind} · {owner}" and the "Modified" column reads `last_modified_at` — the
 * EDIT recency roll-up (node + body + satellite + edge, EXCLUDING opens, ADR-0016),
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
      .select('id,owner_user_id,last_modified_at')
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
    };
  }
  return map;
}

/**
 * Batch-load the CURRENT user's "last opened by me" timestamps (per-user state,
 * own rows under RLS) for the space. Drives the "Recent" filter — recently VIEWED
 * by me — and its "Viewed" column. Maintained by the activity roll-up (ADR-0016):
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
