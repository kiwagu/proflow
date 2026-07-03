import {
  MEDIA_MAX_UPLOAD_DEFAULT_BYTES,
  MEDIA_MAX_UPLOAD_HARD_CAP_BYTES,
} from '@workspace/settings-runtime';
import { z } from 'zod';

/**
 * KB media substrate contracts (ADR-0026). A `file`/`video` node becomes REAL by
 * pairing the (bodyless) `knowledge_resources` node with BYTES in a private
 * `kb-media` Storage bucket and one generic 1:1 satellite `kb.resource_media_meta`
 * (prefix `kmm`, keyed by `node_id`). One generic satellite serves
 * `file`/`video`/`image`/`pdf`/`audio`; per-kind extras (dimensions, page count,
 * codec) are a LATER seam — add nullable fields here, never a per-kind table
 * (ADR-0013 §2).
 *
 * These are DOMAIN + boundary shapes only. Access is NEVER enforced here: the
 * fence is Postgres RLS (the graph predicate `auth_user_can_access_resource`) +
 * the `storage.objects` RLS that mirrors it — the bytes egress ONLY via
 * short-lived, server-authorized signed URLs (never a public URL). `created_by`
 * comes from the SESSION, never from any of these payloads.
 */

/**
 * MIME posture — owner decision "any-except-dangerous" (ADR-0026 §3): the bucket
 * is UNRESTRICTED by design; this small DENYLIST of active-content/executable
 * types (XSS/exec risks even from a private bucket, since a signed URL streams the
 * bytes to the browser) is THE server-side gate. It is deliberately NOT a positive
 * allow-list — the substrate must accept any file. Keep this list tight and
 * conservative; deep byte-sniffing is a later hardening (Phase 3-adjacent).
 */
export const DANGEROUS_MIME_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/javascript',
  'text/javascript',
  'application/x-httpd-php',
] as const;

const DANGEROUS_MIME_SET = new Set<string>(
  DANGEROUS_MIME_TYPES.map((m) => m.toLowerCase())
);

/**
 * The server-side MIME gate: a declared mime is allowed iff it is NOT in the
 * denylist. Normalizes case + strips any `; charset=…` parameter. A blank/absent
 * mime is rejected (fail-closed — an unqualified upload is not allowed).
 */
export function isAllowedMediaMime(mime: string): boolean {
  const base = mime.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (base.length === 0) {
    return false;
  }
  return !DANGEROUS_MIME_SET.has(base);
}

/**
 * Upload-size limits — layered SOFT-over-HARD (ADR-0026 AMENDMENT §A4), CODE
 * constants, NOT env (monorepo-env-minimalism).
 *
 * - `DEFAULT_MAX_UPLOAD_BYTES` (200 MB) is the SOFT default — the registry
 *   `defaultValue` for `platform.media.max_upload_bytes` when no org/global row is
 *   set. The EFFECTIVE soft limit is resolved per-org from `runtime_settings`
 *   (org → global → this default); it is NOT the fence by itself.
 * - `HARD_MAX_UPLOAD_BYTES` (5 GB) is the HARD system cap — code/infra only, NOT
 *   org-editable. It mirrors the storage-api `FILE_SIZE_LIMIT` + the `kb-media`
 *   bucket `file_size_limit` + `config.toml [storage] file_size_limit = "5GiB"`.
 *   The org soft limit can NEVER exceed it.
 *
 * SINGLE SOURCE: both numbers are OWNED by `@workspace/settings-runtime` (the home of
 * the `platform.media.max_upload_bytes` setting whose `defaultValue`/schema `.max()`
 * are these). We only RE-EXPORT them here under the media-domain names the KB code +
 * client already use — no second literal, no drift.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = MEDIA_MAX_UPLOAD_DEFAULT_BYTES; // 200 MB
export const HARD_MAX_UPLOAD_BYTES = MEDIA_MAX_UPLOAD_HARD_CAP_BYTES; // 5 GiB

/**
 * Back-compat alias for the previous single `MAX_MEDIA_SIZE_BYTES` constant. It is
 * NO LONGER the fence — the authorizer reads the RESOLVED per-org limit. Retained
 * only for the client pre-validation display until the resumable client (later
 * wave) switches to the resolved value. Points at the SOFT default (200 MB).
 *
 * @deprecated Use the resolved org limit (server) / `DEFAULT_MAX_UPLOAD_BYTES`.
 */
export const MAX_MEDIA_SIZE_BYTES = DEFAULT_MAX_UPLOAD_BYTES;

/**
 * Signed-URL TTLs — CODE constants, short-lived, NOT env (ADR-0026 §2c). Bytes
 * are re-minted per download/upload; the URL is the only egress.
 *
 * The DOWNLOAD TTL is 3 hours (owner-approved 2026-07-01): video/audio stream via
 * HTTP range requests over a long viewing session, so a 60 s URL would expire
 * mid-playback and break seeking. The bucket stays PRIVATE and the mint is
 * RLS-fenced under the caller (never service-role, never a public URL), so a
 * longer-lived signed URL is an accepted trade-off. This TTL applies to ALL media
 * downloads (image/pdf/video/audio/generic file) — intended.
 *
 * The UPLOAD TTL is 6 hours (owner-approved 2026-07-01, ADR-0026 AMENDMENT §A5):
 * a resumable (TUS) session for a multi-GB file on a modest link can run long, so
 * the authorize-response validity must cover a realistic worst-case upload
 * duration. Still a code constant, not env; the byte fence is UNCHANGED (the TUS
 * session runs under the caller's JWT, fenced by the `storage.objects` INSERT
 * policy).
 */
export const MEDIA_DOWNLOAD_URL_TTL_SECONDS = 10800 as const;
export const MEDIA_UPLOAD_URL_TTL_SECONDS = 21600 as const;

/** The private bucket that holds KB media bytes (ADR-0026 §2a). */
export const KB_MEDIA_BUCKET = 'kb-media' as const;

/**
 * The satellite row shape — `kb.resource_media_meta` (ADR-0027 §2b). 1:1 by
 * `nodeId`, now a thin REFERENCE to a shared `kb.media_blob`: the byte-intrinsic
 * metadata (path, bucket, mime, size, checksum, duration) lives on the BLOB; the
 * reference carries only the per-reference display filename (a copier may rename
 * their copy without touching the shared bytes).
 */
export const resourceMediaMetaSchema = z.object({
  nodeId: z.string().min(1), // knr_… the owning node
  spaceId: z.string().min(1),
  blobId: z.string().min(1), // kmb_… the shared immutable byte record
  originalFilename: z.string().min(1), // display only; NEVER the storage path
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ResourceMediaMeta = z.infer<typeof resourceMediaMetaSchema>;

/**
 * Upload-authorize request (boundary): the client declares the file it intends to
 * PUT. The server authorizes node-`update` under RLS, validates mime + size, mints
 * a signed UPLOAD url to a SERVER-generated path. The declared `mimeType`/
 * `sizeBytes`/`filename` are validated but never trusted as the fence (storage-RLS
 * + the bucket `file_size_limit` are the backstop).
 */
export const mediaUploadAuthorizeRequestSchema = z.object({
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  mimeType: z.string().min(1),
  // Hard belt: reject anything over the 5 GB system cap at the boundary. The SOFT
  // per-org limit is enforced in the authorizer against the RESOLVED runtime
  // setting; this .max() is the code/infra ceiling that can never be exceeded.
  sizeBytes: z.number().int().nonnegative().max(HARD_MAX_UPLOAD_BYTES),
  filename: z.string().min(1),
  // Byte-intrinsic media duration (video/audio), known client-side BEFORE the
  // upload — recorded on the blob at reservation (blob UPDATE is not granted to
  // authenticated, so it cannot be added later; ADR-0027 §2a).
  durationMs: z.number().int().nonnegative().nullable().optional(),
});
export type MediaUploadAuthorizeRequest = z.infer<
  typeof mediaUploadAuthorizeRequestSchema
>;

/**
 * Upload-authorize response. Control-plane ONLY: the server creates a
 * `kb.media_blob` RESERVATION (ADR-0027 §3) and returns its `blobId` + the
 * blob-addressed `storagePath` (`spaces/<spaceId>/kb/blobs/<blobId>/<serverKey>`)
 * the client uploads the bytes to via the resumable (TUS) transport under its own
 * session JWT. `blobId` is echoed back on confirm (`setResourceMedia`) — the kmm
 * reference points at the blob, not at a raw path. The server does NOT mint a
 * signed upload URL — `storage.objects` INSERT RLS (fresh-upload window:
 * uploader's own refcount-0 reservation) is the fence at PUT time.
 */
export const mediaUploadAuthorizeResponseSchema = z.object({
  storagePath: z.string().min(1),
  blobId: z.string().min(1),
});
export type MediaUploadAuthorizeResponse = z.infer<
  typeof mediaUploadAuthorizeResponseSchema
>;

/**
 * The confirm/UPSERT input — written ONLY after a successful upload
 * (`attribute:'media'` on the attributes route → `setResourceMedia`). The kmm
 * reference is `{nodeId → blobId}` + the display filename; byte-intrinsic fields
 * were declared at authorize and live on the blob (ADR-0027 §3). `createdBy` is
 * NOT here: it comes from the SESSION. `checksum` (client-computed sha256) is a
 * best-effort write-once blob extra — kept cheap so B2 content-dedup stays a
 * later index, not a backfill.
 */
export const setResourceMediaRequestSchema = z.object({
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  blobId: z.string().min(1),
  originalFilename: z.string().min(1),
  checksum: z.string().nullable().optional(),
});
export type SetResourceMediaRequest = z.infer<
  typeof setResourceMediaRequestSchema
>;

/**
 * Download-authorize response: the short-lived signed DOWNLOAD url + its absolute
 * expiry. The request carries only `{ spaceId, nodeId }` — the server resolves the
 * satellite row (absence → fail-closed 403/404) and mints the url under the
 * caller's RLS. NO public url, ever.
 */
export const mediaDownloadResponseSchema = z.object({
  signedUrl: z.string().min(1),
  expiresAt: z.string(),
});
export type MediaDownloadResponse = z.infer<typeof mediaDownloadResponseSchema>;

export function parseMediaUploadAuthorizeRequest(raw: unknown) {
  return mediaUploadAuthorizeRequestSchema.safeParse(raw);
}
export function parseSetResourceMediaRequest(raw: unknown) {
  return setResourceMediaRequestSchema.safeParse(raw);
}
