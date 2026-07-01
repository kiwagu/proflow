import type { Database } from '@workspace/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isAllowedMediaMime,
  type MediaUploadAuthorizeRequest,
  type MediaUploadAuthorizeResponse,
} from '@workspace/knowledge-contracts';

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

  const storagePath = buildStoragePath(
    input.spaceId,
    input.nodeId,
    input.filename
  );

  // Control-plane authorization complete. The client uploads the bytes via the
  // resumable (TUS) transport under its OWN session JWT to this server-decided path;
  // the `storage.objects` INSERT policy (mirroring node-update) is the fence at PUT
  // time (ADR-0026 §A2/§A5). The server does NOT mint a signed upload URL — the
  // single-PUT leg was removed with the resumable switch, so no pointless Storage
  // round-trip here.
  return { storagePath };
}
