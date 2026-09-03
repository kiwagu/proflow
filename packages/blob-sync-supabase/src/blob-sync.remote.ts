/**
 * The durable half of media sync, over an S3-compatible object store plus its
 * certificate table. Every call here runs under the CALLER's own identity, so
 * the space fence is enforced at the source and this adapter never needs to
 * know who may see what.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@workspace/db';
import type { BlobInfo, IBlobSyncRemote } from '@workspace/domain';

/** The private bucket holding one immutable object per content hash. */
export const WORKBENCH_BLOB_BUCKET = 'workbench-blobs';

/** How long a download link stays valid. Short by design: the link is a
 * capability, and the client fetches immediately after asking for one. */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * `spaces/<space>/blobs/<hash>` — the space prefix is structure (and the
 * isolation belt the storage policies match on), the hash is the identity.
 * Deliberately the SAME hash the local store keys by, so no layer has to
 * translate between two names for the same bytes.
 */
export function blobObjectKey(spaceId: string, hash: string): string {
  return `spaces/${spaceId}/blobs/${hash}`;
}

export function createSupabaseBlobSyncRemote(
  db: SupabaseClient<Database>,
  spaceId: string
): IBlobSyncRemote {
  const key = (hash: string) => blobObjectKey(spaceId, hash);

  return {
    async isCertified(hash) {
      const { data, error } = await db
        .from('workbench_blobs')
        .select('hash')
        .eq('space_id', spaceId)
        .eq('hash', hash)
        .maybeSingle();
      if (error) {
        throw new Error(`blob sync: certificate read — ${error.message}`);
      }
      return data !== null;
    },

    async putObject(hash, blob) {
      const { error } = await db.storage
        .from(WORKBENCH_BLOB_BUCKET)
        // upsert stays false: objects are immutable, so a collision means the
        // same content is already there and re-writing it would be pointless
        // work at best. The duplicate is swallowed below for exactly that
        // reason — a repeat is success, not a conflict.
        .upload(key(hash), blob, {
          upsert: false,
          contentType: blob.type || 'application/octet-stream',
        });
      if (error && !isDuplicateObject(error)) {
        throw new Error(`blob sync: upload ${hash} — ${error.message}`);
      }
    },

    async certify(info: BlobInfo) {
      const { data: user } = await db.auth.getUser();
      const userId = user.user?.id;
      if (!userId) {
        throw new Error('blob sync: certify requires an authenticated session');
      }
      const { error } = await db.from('workbench_blobs').insert({
        space_id: spaceId,
        hash: info.hash,
        size: info.size,
        mime: info.mime,
        created_by: userId,
      });
      // A row this device is racing another device to write is the SAME row —
      // the primary key is (space, content hash) — so losing the race is the
      // outcome we wanted anyway.
      if (error && !isDuplicateRow(error)) {
        throw new Error(`blob sync: certify ${info.hash} — ${error.message}`);
      }
    },

    async fetchObject(hash) {
      const { data, error } = await db.storage
        .from(WORKBENCH_BLOB_BUCKET)
        .createSignedUrl(key(hash), SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        // No signed url means no readable object: either nothing is there or
        // the caller may not see it. Both are "nothing to pull" to the loop
        // above, and keeping them indistinguishable avoids an existence oracle.
        return null;
      }
      const response = await fetch(data.signedUrl);
      if (!response.ok) return null;
      return response.blob();
    },
  };
}

/** Storage reports an existing key as a conflict; content addressing makes
 * that a no-op rather than an error. */
function isDuplicateObject(error: { message: string }): boolean {
  return /already exists|duplicate|conflict/i.test(error.message);
}

/** Postgres unique-violation, by code when available and by message otherwise. */
function isDuplicateRow(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || /duplicate key/i.test(error.message);
}
