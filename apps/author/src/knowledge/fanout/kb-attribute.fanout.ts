import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';

import { kbSchema } from '@/lib/supabase/kb-schema';

/**
 * KB application-attribute write module — UI-agnostic (ADR-0005 §b / ADR-0011 §4).
 * Each KB attribute is a per-node SATELLITE in the dedicated `kb` schema (ADR-0013):
 * a 1:1 row keyed by `node_id`. These functions are the write seam; the route is a
 * thin transport and the view holds none of this logic. EVERY write runs under the
 * user's RLS-scoped `db`; RLS mirrors the parent node's access (write =
 * `space.knowledge.update`). Grows one satellite at a time as its feature lands.
 */

export type KbAttributeDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id (created_by attribution). */
  userId: string;
};

const ON_NODE_ID = 'node_id' as const;

export type SetResourceDescriptionInput = {
  spaceId: string;
  nodeId: string;
  body: string;
};

/**
 * Set/update a node's description (UPSERT by node_id) under the user's RLS
 * (`space.knowledge.update`). The text is the field a future RAG vector seam will
 * embed; the text is stored now, the vector is not (poc-no-fallbacks).
 */
export async function setResourceDescription(
  input: SetResourceDescriptionInput,
  deps: KbAttributeDeps
): Promise<{ node_id: string; body: string }> {
  const { db, userId } = deps;
  const { data, error } = await kbSchema(db)
    .from('resource_description')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        body: input.body,
        created_by: userId,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,body')
    .single();
  if (error || !data) {
    // RLS rejection (no update verb / node not accessible) → clean failure.
    throw new Error(`setResourceDescription: ${error?.message ?? 'no row'}`);
  }
  return { node_id: data.node_id, body: data.body };
}

export type SetResourceMediaInput = {
  spaceId: string;
  nodeId: string;
  blobId: string;
  originalFilename: string;
  checksum?: string | null;
};

/**
 * Set/update a node's media REFERENCE (UPSERT by node_id) under the user's RLS
 * (`space.knowledge.update`), the CONFIRM leg of an upload (ADR-0027 §3): called
 * ONLY after the bytes have landed in the `kb-media` bucket. The kmm row points
 * `{node_id → blob_id}` — the refcount trigger increments on this insert (or
 * re-points on a replace: the old blob's count drops, the reaper collects it at
 * 0). Byte-intrinsic metadata was written on the blob at authorize; the optional
 * client-computed `checksum` is set write-once via the SECURITY DEFINER helper
 * (best-effort — blob UPDATE is not granted to authenticated). `created_by`
 * comes from `deps.userId`, NEVER the body.
 */
export async function setResourceMedia(
  input: SetResourceMediaInput,
  deps: KbAttributeDeps
): Promise<{ node_id: string; blob_id: string }> {
  const { db, userId } = deps;
  const { data, error } = await kbSchema(db)
    .from('resource_media_meta')
    .upsert(
      {
        node_id: input.nodeId,
        space_id: input.spaceId,
        blob_id: input.blobId,
        original_filename: input.originalFilename,
        created_by: userId,
      },
      { onConflict: ON_NODE_ID }
    )
    .select('node_id,blob_id')
    .single();
  if (error || !data) {
    // RLS rejection (no update verb / node not accessible) → clean failure.
    throw new Error(`setResourceMedia: ${error?.message ?? 'no row'}`);
  }

  if (input.checksum) {
    // Best-effort write-once checksum on the caller's OWN blob — a column-scoped
    // UPDATE (only `checksum` is grantable) fenced by RLS to the uploader's
    // not-yet-set blob. A non-uploader / already-set row simply matches no row.
    await kbSchema(db)
      .from('media_blob')
      .update({ checksum: input.checksum })
      .eq('id', input.blobId);
  }

  return { node_id: data.node_id, blob_id: data.blob_id };
}
