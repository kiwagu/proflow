import {
  parseSearchQuery,
  type SearchQuery,
  type SearchResult,
} from '@workspace/knowledge-contracts';
import { resolveSearch } from '@workspace/knowledge-engine';

import { createRlsClientFromServerCookies } from '@/lib/supabase/rls-from-cookies';

import {
  createProjectionResolveTransport,
  resolveJwtClaimsFromSession,
} from './projection-resolve.transport';

/**
 * Server-side search-resolve entry (ADR-0024 §2/§6). A SIBLING of
 * `resolveDefaultLensProjection`: it builds the SAME RLS transport
 * (`createProjectionResolveTransport(claims)`, REUSED verbatim — ADR-0009) and
 * calls the engine `resolveSearch`. NO new DB path, NO service-role — RLS is the
 * sole access fence (ADR-0001/0009/0023): the compiled SELECT runs AS THE USER, so
 * a private / other-space node never appears for a non-grantee. The optional
 * `scope.statuses`/`scope.visibility` narrowing can only shrink the user's already
 * RLS-fenced set, never widen access (`poc-no-fallbacks` — no fake fence).
 *
 * The browser sends only the `SearchQuery` (term + scope + paging); raw SQL never
 * crosses the client→server boundary — the engine compiles it here on the server.
 */
export async function resolveSearchQuery(
  query: SearchQuery
): Promise<SearchResult> {
  const parsed = parseSearchQuery(query);
  if (!parsed.success) {
    throw new Error('resolveSearchQuery: invalid search query');
  }

  const db = await createRlsClientFromServerCookies();
  const claims = await resolveJwtClaimsFromSession(db);
  return resolveSearch(parsed.data, {
    transport: createProjectionResolveTransport(claims),
  });
}
