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
} from '@/app/graph/graph-data.types';

/**
 * Server-side data access for the `/author/graph/*` render pages. Everything here
 * runs under the USER's RLS-scoped client (`createRlsClientFromServerCookies`) —
 * NEVER service-role (ADR-0003 §2). Postgres RLS is the sole access authority: a
 * user without `space.knowledge.read` resolves to an empty editor, never an error.
 */

/** Resolve the active space from the canonical cookie the proxy maintains. */
export async function resolveActiveSpaceId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_SPACE_COOKIE)?.value?.trim() || undefined;
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
 * Resolve the default implicit lens projection for the active space. No
 * `projections` row is read — the spec is built in code and validated at the
 * boundary (zod), then executed under the user's RLS via the landed transport
 * (ADR-0009), never service-role. An ungranted user resolves to `items=[]`.
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
  const { data, error } = await kbSchema(db)
    .from('resource_description')
    .select('node_id,body')
    .eq('space_id', spaceId)
    .in('node_id', itemIds);
  if (error) {
    throw new Error(`loadKbAttributesForItems: ${error.message}`);
  }
  for (const row of data ?? []) {
    (map[row.node_id] ??= {}).description = row.body;
  }
  return map;
}

/**
 * Batch-load owner + updated_at for the resolved item set. The Drive meta line
 * shows "{kind} · {owner}"; neither field is in the frozen result contract, so
 * they ride alongside as a thin RLS-scoped select (same authority as the resolve).
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
