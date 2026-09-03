import {
  KB_MEDIA_BUCKET,
  MEDIA_DOWNLOAD_URL_TTL_SECONDS,
  type MediaDownloadResponse,
} from '@workspace/knowledge-contracts';

import { kbSchema } from '@workspace/db/kb-schema';
import {
  MediaAuthorizeError,
  type MediaAuthorizeDeps,
} from './media-upload-authorize';

/**
 * KB media DOWNLOAD authorizer — UI-agnostic server module.
 *
 * Under the caller's RLS, resolve the media satellite for the node. The satellite's
 * SELECT policy mirrors node-`read`, so a non-grantee simply sees NO row →
 * fail-closed 403/404 (never a leak). Only on a resolved row do we mint a
 * short-lived signed DOWNLOAD url with the SAME user-scoped client (its JWT is the
 * storage identity) — NEVER service-role, NEVER `getPublicUrl`. The
 * `storage.objects` SELECT policy is the enforcing backstop on the mint itself.
 */
export async function authorizeMediaDownload(
  input: { spaceId: string; nodeId: string },
  deps: MediaAuthorizeDeps
): Promise<MediaDownloadResponse> {
  const { db } = deps;

  // RLS-fenced read of the satellite: absence (non-grantee / wrong space) → 404.
  const { data: meta, error: metaErr } = await kbSchema(db)
    .from('resource_media_meta')
    .select('blob_id')
    .eq('node_id', input.nodeId)
    .eq('space_id', input.spaceId)
    .maybeSingle();
  if (metaErr) {
    throw new MediaAuthorizeError('Download not authorized.', 403);
  }
  if (!meta?.blob_id) {
    throw new MediaAuthorizeError('Media not found.', 404);
  }

  // Resolve the SHARED blob for its path: the blob SELECT policy
  // grants it to any holder of a readable reference — the kmm row just resolved.
  const { data: blob, error: blobErr } = await kbSchema(db)
    .from('media_blob')
    .select('storage_path,storage_bucket')
    .eq('id', meta.blob_id)
    .maybeSingle();
  if (blobErr || !blob?.storage_path) {
    throw new MediaAuthorizeError('Media not found.', 404);
  }

  const bucket = blob.storage_bucket ?? KB_MEDIA_BUCKET;
  const { data: signed, error: signErr } = await db.storage
    .from(bucket)
    .createSignedUrl(blob.storage_path, MEDIA_DOWNLOAD_URL_TTL_SECONDS);
  if (signErr || !signed?.signedUrl) {
    // storage-RLS refused (non-grantee) or the object is missing → fail-closed.
    throw new MediaAuthorizeError(
      signErr?.message ?? 'Could not mint download URL.',
      403
    );
  }

  const expiresAt = new Date(
    Date.now() + MEDIA_DOWNLOAD_URL_TTL_SECONDS * 1000
  ).toISOString();

  return { signedUrl: signed.signedUrl, expiresAt };
}
