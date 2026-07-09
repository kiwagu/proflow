import type { Database } from '@workspace/db';
import { createEntityIdFor } from '@workspace/entity-id';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isAllowedMediaMime,
  type MediaUploadAuthorizeRequest,
  type MediaUploadAuthorizeResponse,
} from '@workspace/knowledge-contracts';

import { kbSchema } from '@/lib/supabase/kb-schema';

import { resolveMediaMaxUploadBytes } from './media-limit.resolve';

/**
 * KB media UPLOAD authorizer — UI-agnostic server module (ADR-0026 §3).
 *
 * The server stays on the CONTROL plane: it authorizes node-`update` under the
 * caller's RLS, validates the DECLARED mime/size, decides a SERVER-generated safe
 * path, and mints a short-lived signed UPLOAD url. The client then PUTs the bytes
 * DIRECTLY to Storage (the server never buffers them). The `storage.objects` INSERT
 * policy (mirroring node-`update`) is the RLS backstop; this explicit authorize
 * only exists so a denied caller gets a clean 403 instead of a Storage error
 * (ADR-0009).
 *
 * EVERY call runs under the user's RLS-scoped `db` — NEVER service-role. The signed
 * url is minted with THAT client, so its JWT is the storage identity and
 * `storage.objects` RLS enforces. `created_by` is not set here (the metadata write
 * on confirm sets it from the SESSION).
 */

export type MediaAuthorizeDeps = {
  /** User's RLS-scoped supabase-js client — NEVER service-role. */
  db: SupabaseClient<Database>;
  /** Authenticated Supabase user id. */
  userId: string;
};

export class MediaAuthorizeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404
  ) {
    super(message);
    this.name = 'MediaAuthorizeError';
  }
}

/**
 * A conservative safe extension derived from the filename (letters/digits only,
 * max 12 chars). The extension is cosmetic — the storage key never trusts the raw
 * filename (traversal/collision safety, ADR-0026 §2a); the original filename is
 * display-only metadata.
 */
function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) {
    return '';
  }
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? `.${ext}` : '';
}

/**
 * `spaces/<spaceId>/kb/blobs/<blobId>/<serverKey>` — the ADR-0027 §2a
 * blob-addressed, node-agnostic path. The blob id is a FOLDER segment
 * (`storage.foldername()` excludes the terminal filename, and every
 * `storage.objects` policy resolves the blob via segment [5]); the server key
 * stays the filename so the object keeps a safe extension.
 */
function buildStoragePath(
  spaceId: string,
  blobId: string,
  filename: string
): string {
  const serverKey = `${crypto.randomUUID()}${safeExtension(filename)}`;
  return `spaces/${spaceId}/kb/blobs/${blobId}/${serverKey}`;
}

/**
 * Authorize an upload to a node and mint a signed upload url. Fails CLOSED: an
 * unresolvable/unupdatable node → 403 (no row under RLS), a bad mime/size → 400.
 */
export async function authorizeMediaUpload(
  input: MediaUploadAuthorizeRequest,
  deps: MediaAuthorizeDeps
): Promise<MediaUploadAuthorizeResponse> {
  const { db } = deps;

  if (!isAllowedMediaMime(input.mimeType)) {
    throw new MediaAuthorizeError('Unsupported file type.', 400);
  }

  // SOFT limit (ADR-0026 AMENDMENT §A4): the effective per-org max resolved under
  // the caller's RLS (org → global → default), clamped to the 5 GB hard cap. This
  // replaces the former hardcoded MAX_MEDIA_SIZE_BYTES — an org admin governs it
  // via the runtime setting. A breach is a clean 400. The HARD cap is also enforced
  // at the boundary (request-schema .max) and by storage-api; this is the tunable
  // soft belt.
  const maxUploadBytes = await resolveMediaMaxUploadBytes(db, input.spaceId);
  if (input.sizeBytes > maxUploadBytes) {
    throw new MediaAuthorizeError('File exceeds the maximum size.', 400);
  }

  // Existence + READ fence (fail-closed): the SELECT is RLS-scoped, so a node the
  // caller cannot even see yields no row → 404. Then the node-UPDATE fence, mirroring
  // the `knowledge_resources` UPDATE policy EXACTLY: owner-sovereign OR the space-level
  // `space.knowledge.update` verb. Grants are a READ dimension (ADR-0017 §1.5) and are
  // deliberately NOT composed for WRITES — a read-grantee can download the bytes but
  // must NOT overwrite/delete them (ADR-0026 amended: the write fence mirrors node-edit,
  // not the read-composition predicate). The check is side-effect-free (no UPDATE probe
  // — that would bump `updated_at`/recency); the `storage.objects` INSERT policy enforces
  // the SAME fence as the backstop at mint.
  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .select('id,owner_user_id')
    .eq('id', input.nodeId)
    .eq('space_id', input.spaceId)
    .maybeSingle();
  if (nodeErr) {
    throw new MediaAuthorizeError('Upload not authorized.', 403);
  }
  if (!node?.id) {
    throw new MediaAuthorizeError('Node not found or not accessible.', 404);
  }

  if (node.owner_user_id !== deps.userId) {
    const { data: canUpdate, error: verbErr } = await db.rpc(
      'auth_user_can_access_in_space',
      { p_space_id: input.spaceId, p_permission_key: 'space.knowledge.update' }
    );
    if (verbErr || canUpdate !== true) {
      throw new MediaAuthorizeError('Node not updatable.', 403);
    }
  }

  // Reserve the blob (ADR-0027 §3): the byte record must EXIST before the PUT —
  // the `storage.objects` INSERT policy authorizes ONLY the uploader's own
  // refcount-0 reservation. The id is minted here (the blob-addressed path embeds
  // it, so a DB-generated default can't work). `provenance_author_id` = the
  // uploader (the "zero author" starts as the physical creator); a reservation
  // that never confirms stays refcount-0 with no kmm → the reconcile reaper's job.
  const blobId = createEntityIdFor('kbMediaBlob');
  const storagePath = buildStoragePath(input.spaceId, blobId, input.filename);
  const { error: blobErr } = await kbSchema(db)
    .from('media_blob')
    .insert({
      id: blobId,
      space_id: input.spaceId,
      storage_path: storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      duration_ms: input.durationMs ?? null,
      provenance_author_id: deps.userId,
      uploaded_by: deps.userId,
    });
  if (blobErr) {
    throw new MediaAuthorizeError('Upload not authorized.', 403);
  }

  // Control-plane authorization complete. The client uploads the bytes via the
  // resumable (TUS) transport under its OWN session JWT to this server-decided
  // path; the `storage.objects` INSERT policy (the fresh-upload window: the
  // caller's own unreferenced reservation) is the fence at PUT time. The server
  // does NOT mint a signed upload URL. `blobId` is echoed back on confirm — the
  // kmm reference points at the blob, never at a raw path.
  return { storagePath, blobId };
}
