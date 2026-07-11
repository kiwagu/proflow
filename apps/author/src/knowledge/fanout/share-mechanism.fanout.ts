import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ShareMechanism,
  ShareMechanismByItem,
} from '@/app/graph/graph-data.types';

/**
 * "Shared with me" mechanism distinction — a READ-ONLY batched
 * annotation over the shared-lens node set, telling the current user WHICH additive
 * grant makes each node visible to them. NO new table, NO resolver change, NO new
 * access dimension: it reads the per-user grant table (`knowledge_resource_user_grants`),
 * the cohort link table (`knowledge_resource_scopes`) joined to my
 * scope memberships, and derives the residual — all ALREADY landed. Invariant #1 holds.
 *
 * The resolver returns visible nodes WITHOUT the matched disjunct, and it is FROZEN
 * (`security invoker`). We re-derive the mechanism by re-checking, for the
 * ALREADY-VISIBLE set, which additive grant admits me. The three mechanisms, in
 * precedence order (most deliberate first):
 *
 *   - `personal`  — the node is in `knowledge_resource_user_grants` for ME
 *                   (`resource_id IN (ids) AND user_id = auth.uid()`).
 *   - `cohort`    — the node is fenced to a cohort I belong to
 *                   (`knowledge_resource_scopes` ⋈ `scope_memberships` for me), batched.
 *   - `broadcast` — the RESIDUAL: any shared id matched by NEITHER above. It is visible,
 *                   so SOME mechanism admits it — that is the space/org floor or the
 *                   supervisory hierarchy (`auth_user_manages_owner`), both FOLDED into
 *                   "broadcast" for v1.
 *
 * Precedence `personal > cohort > broadcast`: a node admitted by several mechanisms
 * reports the most deliberate one.
 *
 * PURE DISPLAY ENRICHMENT, never a fence (normative): EVERY read runs under the user's
 * RLS-scoped `db` — NEVER service-role. The input is an already-RLS-admitted set (a node
 * not visible to the user is never passed in), so the annotation can only DESCRIBE access
 * the user already has — it never adds, removes, or narrows a node. It cannot leak: the
 * grant/scope SELECT RLS only returns rows the caller's space-read admits, and a node
 * absent from the shared set is never annotated.
 *
 * BATCHED, not per-node: a constant `O(1)` count of reads for the WHOLE set, regardless
 * of node count — ONE constant membership read (my cohorts) + TWO node-keyed IN-list
 * reads (personal grants + cohort links over the node set). `broadcast` is the in-memory
 * residual (no read of its own). Parity with the landed batched IN-list selects (commit
 * 49a965c); each IN-list is chunked to keep the PostgREST GET URL under the REST gateway
 * (~4 KB) limit — never N queries.
 */

/** Chunk size for `.in('resource_id', …)` selects — keeps each PostgREST GET URL under
 * the Supabase REST gateway (Kong/nginx) ~4 KB limit (parity with the page load's
 * `inChunks`; a large id set otherwise 502s). Chunking does NOT change the read count
 * semantics: it is still ONE logical IN-list read per mechanism, just split to fit the
 * URL cap — never per-node. */
const IN_CHUNK_SIZE = 50;

/**
 * The subset of `nodeIds` matched by a link-table read for the current user, run under
 * the caller's RLS in chunked IN-list selects (`runChunk` is the per-mechanism query
 * over one chunk of node ids). Chunking splits the IN-list to fit the gateway URL cap;
 * it is still ONE logical IN-list read per mechanism, never per-node. Returns the set of
 * matched `resource_id`s.
 */
async function matchedResourceIds(
  nodeIds: string[],
  runChunk: (chunk: string[]) => Promise<{ resource_id: string }[]>
): Promise<Set<string>> {
  const matched = new Set<string>();
  for (let i = 0; i < nodeIds.length; i += IN_CHUNK_SIZE) {
    const chunk = nodeIds.slice(i, i + IN_CHUNK_SIZE);
    const rows = await runChunk(chunk);
    for (const row of rows) {
      matched.add(row.resource_id);
    }
  }
  return matched;
}

/**
 * Annotate each node in the "Shared with me" set with the WINNING mechanism that grants
 * the CURRENT user access. All reads RLS-scoped — never service-role.
 *
 * @param input.spaceId  the active space (the nodes are already scoped to it).
 * @param input.nodeIds  the shared-set node ids — "visible nodes I do NOT own" (the same
 *                       set the `'shared'` lens filters to). Already RLS-admitted.
 * @returns a `Record<nodeId, ShareMechanism>` — every input id gets a mechanism. A node
 *          matched by neither a personal grant nor a cohort I belong to is `broadcast`
 *          (the residual: floor/supervisory). Empty input → empty map.
 *
 * Batched, NEVER per-node — the node-set reads are exactly TWO IN-lists (personal +
 * cohort-links), each independent of how many cohorts I'm in:
 *   0. my cohorts — `scope_memberships WHERE user_id = auth.uid()` (ONE constant read,
 *      O(my cohorts), NOT a function of node count) → my scope ids.
 *   1. personal — `knowledge_resource_user_grants WHERE resource_id IN (ids) AND
 *      user_id = auth.uid()` (the grantee-keyed index hot path) → personally-granted ids.
 *   2. cohort   — `knowledge_resource_scopes WHERE resource_id IN (ids) AND scope_id IN
 *      (my scope ids)` → ids fenced to a cohort I'm in. ONE IN-list over the node set
 *      (the `scope_id IN (myScopes)` conjunct is the constant membership filter, not a
 *      second node-keyed read). Skipped entirely when I'm in no cohort.
 *   3. broadcast — derived IN MEMORY as the residual (no DB read of its own): any id in
 *      the set explained by neither personal nor cohort.
 * (Chunking splits each IN-list to fit the URL cap; it never turns into a per-node read.)
 */
export async function annotateShareMechanism(
  input: { spaceId: string; nodeIds: string[] },
  deps: { db: SupabaseClient<Database> }
): Promise<ShareMechanismByItem> {
  const { db } = deps;
  const annotation: ShareMechanismByItem = {};
  const nodeIds = Array.from(new Set(input.nodeIds));
  if (nodeIds.length === 0) {
    return annotation;
  }

  // The CURRENT user. A guest has no grants/memberships → every shared node is the
  // residual `broadcast` (it is visible to them only via the floor). This NEVER changes
  // visibility — the set was already RLS-admitted upstream.
  const { data: auth } = await db.auth.getUser();
  const me = auth.user?.id;

  // READ 1 (personal): the subset granted directly to ME. The grant SELECT RLS scopes
  // the read to my space's grant rows; `user_id = me` narrows to grants TO me. Guests
  // (no `me`) skip the read — they can hold no per-user grant.
  const personal = me
    ? await matchedResourceIds(nodeIds, async (chunk) => {
        const { data, error } = await db
          .from('knowledge_resource_user_grants')
          .select('resource_id')
          .eq('user_id', me)
          .in('resource_id', chunk);
        if (error) {
          throw new Error(`annotateShareMechanism personal: ${error.message}`);
        }
        return (data ?? []) as { resource_id: string }[];
      })
    : new Set<string>();

  // READ 0 (my cohorts): the scope ids I belong to — ONE constant read, O(my cohorts),
  // independent of node count. Via the `knowledge_user_scope_ids` SECURITY-DEFINER RPC,
  // NOT a direct `scope_memberships` select: that table's SELECT RLS gates on the LEGACY
  // `space.content.read` verb, which a plain `member` (who holds `space.knowledge.read`
  // but not content.read) lacks — a direct read would return nothing and mislabel a
  // cohort-granted node as `broadcast`. The RPC is the batched twin of the landed
  // `knowledge_resource_scope_member` predicate (also security-definer for this reason);
  // it returns ONLY my own memberships (keyed on auth.uid() inside), so it discloses
  // nothing and decides no visibility. Empty (I'm in no cohort) → the cohort read is
  // skipped and no node can be `cohort` for me.
  const myScopeIds = me
    ? await (async () => {
        const { data, error } = await db.rpc('knowledge_user_scope_ids');
        if (error) {
          throw new Error(`annotateShareMechanism scopes: ${error.message}`);
        }
        return Array.from(new Set((data ?? []) as string[]));
      })()
    : [];

  // READ 2 (cohort): the subset fenced to a cohort I belong to. Mirrors the landed
  // `knowledge_resource_scope_member` predicate (a resource linked to >= 1 cohort I'm a
  // member of), batched: ONE IN-list over the node set with the constant
  // `scope_id IN (myScopeIds)` membership conjunct — a row returns ONLY for a node linked
  // to a cohort I'm in. No embed (avoids the two-FKs-to-`scopes` ambiguity); the
  // membership filter is the READ-0 set, not a second node-keyed read.
  const cohort =
    myScopeIds.length > 0
      ? await matchedResourceIds(nodeIds, async (chunk) => {
          const { data, error } = await db
            .from('knowledge_resource_scopes')
            .select('resource_id')
            .in('scope_id', myScopeIds)
            .in('resource_id', chunk);
          if (error) {
            throw new Error(`annotateShareMechanism cohort: ${error.message}`);
          }
          return (data ?? []) as { resource_id: string }[];
        })
      : new Set<string>();

  // Assign the WINNING mechanism per node with precedence personal > cohort > broadcast.
  // Every input id gets an entry: the residual (neither personal nor cohort) is
  // `broadcast` by construction — the node is visible, so the floor/supervisory branch
  // admits it.
  for (const id of nodeIds) {
    let mechanism: ShareMechanism;
    if (personal.has(id)) {
      mechanism = 'personal';
    } else if (cohort.has(id)) {
      mechanism = 'cohort';
    } else {
      mechanism = 'broadcast';
    }
    annotation[id] = mechanism;
  }
  return annotation;
}
