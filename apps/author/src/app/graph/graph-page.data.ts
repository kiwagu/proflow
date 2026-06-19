import { ACTIVE_SPACE_COOKIE } from '@workspace/gateway-auth/active-space.constants';
import {
  createGraphTranslator,
  loadGraphMessages,
  type GraphTranslator,
} from '@workspace/i18n-catalogs/graph';
import { cookies } from 'next/headers';

import { createRlsClientFromServerCookies } from '@/lib/supabase/rls-from-cookies';

/**
 * Server-side data access for the `/author/graph/*` render pages. Everything here
 * runs under the USER's RLS-scoped client (`createRlsClientFromServerCookies`) —
 * NEVER service-role (ADR-0003 §2). Postgres RLS is the sole access authority: a
 * user without `space.knowledge.read` simply gets no projections / empty items.
 */

const DEFAULT_LOCALE = 'en';

/** A saved projection the user may switch between over the same graph. */
export type ProjectionOption = {
  id: string;
  name: string;
};

/** Resolve the active space from the canonical cookie the proxy maintains. */
export async function resolveActiveSpaceId(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_SPACE_COOKIE)?.value?.trim() || undefined;
}

/** Load the consumer-surface translator (default locale for this POC slice). */
export async function loadGraphTranslator(): Promise<GraphTranslator> {
  const messages = await loadGraphMessages(DEFAULT_LOCALE);
  return createGraphTranslator(messages);
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
