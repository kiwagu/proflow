import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import { kbSchema } from '@/lib/supabase/kb-schema';

/**
 * Per-user "open" write module — UI-agnostic (ADR-0005 §b / ADR-0016 §3.3, §5.4).
 * Records a DELIBERATE open of a knowledge resource by the current user: an
 * append to the `kb.resource_activity` log (`kind=open`, `source=open`,
 * `user_id` from the SESSION). The DB roll-up trigger advances
 * `resource_user_state.last_opened_at` from that row. This is the "recently opened
 * by me" signal; it is per-user state on the existing anchor, NOT a new model.
 *
 * Every write runs under the USER's RLS-scoped `db` — NEVER service-role. The open
 * append is gated by the dedicated `space.knowledge.open` verb — a READ-TIER verb
 * held by whoever holds `space.knowledge.read` (ADR-0017 §3). An RLS rejection is a
 * clean no-op (best-effort): a failed open must never block the read (§3.3).
 */

export type RecordResourceOpenedDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (the open's `user_id`, from the session). */
  userId: string;
};

export type RecordResourceOpenedInput = {
  spaceId: string;
  nodeId: string;
};

export type RecordResourceOpenedResult = {
  ok: boolean;
  /** True when the open log row landed (the roll-up then advances last_opened_at). */
  recorded: boolean;
};

export async function recordResourceOpened(
  input: RecordResourceOpenedInput,
  deps: RecordResourceOpenedDeps
): Promise<RecordResourceOpenedResult> {
  const { db, userId } = deps;

  // Append the authoritative `open` activity row under the user's RLS, gated by
  // `space.knowledge.open` (read-tier — held by whoever holds `read`). The
  // SECURITY DEFINER roll-up trigger UPSERTS the resource_user_state anchor and
  // advances `last_opened_at` from this row — so the route never writes the
  // anchor itself. That keeps the "opened by me" signal honest for every reader
  // via its own dedicated `open` verb, independent of the separate read-tier
  // `space.knowledge.progress` (course-pacing) verb.
  const { error } = await kbSchema(db).from('resource_activity').insert({
    space_id: input.spaceId,
    resource_id: input.nodeId,
    user_id: userId,
    kind: 'open',
    source: 'open',
  });
  if (error) {
    // RLS rejection (no space.knowledge.open / node not accessible) → clean no-op.
    return { ok: false, recorded: false };
  }
  return { ok: true, recorded: true };
}
