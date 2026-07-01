import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  KB_MEDIA_BUCKET,
  MAX_MEDIA_SIZE_BYTES,
  isAllowedMediaMime,
  type MediaUploadAuthorizeRequest,
  type MediaUploadAuthorizeResponse,
} from '@workspace/knowledge-contracts';

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

/** `spaces/<spaceId>/kb/<nodeId>/<serverKey>` — the ADR-0026 §2a path convention. */
function buildStoragePath(
  spaceId: string,
  nodeId: string,
  filename: string
): string {
  const serverKey = `${crypto.randomUUID()}${safeExtension(filename)}`;
  return `spaces/${spaceId}/kb/${nodeId}/${serverKey}`;
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
  if (input.sizeBytes > MAX_MEDIA_SIZE_BYTES) {
    throw new MediaAuthorizeError('File exceeds the maximum size.', 400);
  }

  // Existence + READ fence (fail-closed): the SELECT is RLS-scoped, so a node the
  // caller cannot even see yields no row → 404. The node-UPDATE fence is
  // deliberately NOT re-implemented here — duplicating it would drift from the
  // composing predicate `private.auth_user_can_access_resource` (owner ⊕ base/floor
  // ⊕ per-user grant ⊕ hierarchy ⊕ ADR-0023 inherited grant), which is private /
  // non-REST-callable. Instead the `storage.objects` INSERT policy mirrors
  // node-update EXACTLY and gates the mint below under the caller's JWT, so a denied
  // caller is refused there and per-user / inherited-containment grants
  // (ADR-0019/0023) compose for free — no coarser space-level stand-in that would
  // wrongly deny a node-level grantee.
  const { data: node, error: nodeErr } = await db
    .from('knowledge_resources')
    .select('id')
    .eq('id', input.nodeId)
    .eq('space_id', input.spaceId)
    .maybeSingle();
  if (nodeErr) {
    throw new MediaAuthorizeError('Upload not authorized.', 403);
  }
  if (!node?.id) {
    throw new MediaAuthorizeError('Node not found or not accessible.', 404);
  }

  const storagePath = buildStoragePath(
    input.spaceId,
    input.nodeId,
    input.filename
  );

  // Mint with the USER-scoped client (its JWT is the storage identity) — never
  // service-role. `storage.objects` INSERT RLS mirrors node-update, so a token to a
  // node the caller cannot update would be refused at PUT time anyway.
  const { data: signed, error: signErr } = await db.storage
    .from(KB_MEDIA_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed?.signedUrl) {
    throw new MediaAuthorizeError(
      signErr?.message ?? 'Could not mint upload URL.',
      403
    );
  }

  return {
    signedUrl: signed.signedUrl,
    storagePath,
    token: signed.token,
  };
}
