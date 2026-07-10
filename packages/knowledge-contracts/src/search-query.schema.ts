import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';

/**
 * SearchQuery — the input contract for the lexical search capability (ADR-0024).
 * Search is a SIBLING of projection-resolve, not a sub-case: its own zod
 * contract, its own compiler, its own resolver — REUSING the projection-resolve
 * RLS transport (ADR-0009). RLS is the sole access fence; the `scope.*` narrowing
 * below can only SHRINK an already-fenced set, never widen access.
 *
 * Contract boundary (parity with ProjectionSpec): a SearchQuery NEVER carries an
 * access condition. `scope.spaceId` selects the space the user is browsing; the
 * optional `kinds`/`statuses`/`visibility` are user-facing query NARROWING (reuse
 * of the FilterNode-style narrowing), NOT the access fence (the fence is RLS in
 * the transport — ADR-0024 §6).
 *
 * The `mode` discriminant is fixed to `'lexical'` today; it is the explicit SEAM
 * where `'semantic'` (pgvector ANN) is added later (ADR-0024 §4/§7) WITHOUT a
 * contract break — modeled as a discriminated union so a second mode is additive.
 */

export const SEARCH_QUERY_SCHEMA_VERSION = 1 as const;

/** Default page size when a caller omits `limit` (a compiler/contract constant). */
export const SEARCH_DEFAULT_LIMIT = 25;
/** Hard upper bound on page size — clamps a hostile/oversized `limit`. */
export const SEARCH_MAX_LIMIT = 100;

/**
 * Optional query narrowing over an already-RLS-fenced set. Mirrors the FilterNode
 * field allow-list (`kind`/`status`/`visibility`) — every entry NARROWS results;
 * none can express identity/space/permission and none widens access.
 */
export const searchScopeSchema = z.object({
  spaceId: entityIds.space.prefixSchema,
  // optional kind narrowing (folder/file/text/video/link/…)
  kinds: z.array(z.string()).optional(),
  // optional workflow-status narrowing — NOT an access fence
  statuses: z.array(z.string()).optional(),
  // optional visibility narrowing — NOT an access fence
  visibility: z.array(z.string()).optional(),
});
export type SearchScope = z.infer<typeof searchScopeSchema>;

/**
 * The shared (mode-agnostic) fields every search mode carries. Kept separate so a
 * future `'semantic'` member extends the SAME base — the discriminant is `mode`.
 */
const searchQueryBaseSchema = z.object({
  // the user's raw query (trimmed; min length enforced client-side)
  term: z.string(),
  scope: searchScopeSchema.optional(),
  // page size; clamped to [1, SEARCH_MAX_LIMIT] by the compiler
  limit: z
    .number()
    .int()
    .positive()
    .max(SEARCH_MAX_LIMIT)
    .default(SEARCH_DEFAULT_LIMIT),
  // opaque keyset cursor (encodes score+id) for "load more"
  cursor: z.string().optional(),
});

/**
 * Lexical mode — the only mode today. `mode: 'lexical'` is the discriminant; a
 * `'semantic'` member is added here later (ADR-0024 §4) as a second union arm.
 */
export const lexicalSearchQuerySchema = searchQueryBaseSchema.extend({
  mode: z.literal('lexical'),
});

/**
 * SearchQuery — a discriminated union on `mode`. One arm today (`'lexical'`); the
 * union shape is the non-breaking seam for `'semantic'` (ADR-0024 §4/§7).
 */
export const searchQuerySchema = z.discriminatedUnion('mode', [
  lexicalSearchQuerySchema,
]);
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type LexicalSearchQuery = z.infer<typeof lexicalSearchQuerySchema>;

export function parseSearchQuery(raw: unknown) {
  return searchQuerySchema.safeParse(raw);
}
