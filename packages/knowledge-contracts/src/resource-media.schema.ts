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
 * Max upload size — a CODE constant, NOT env (monorepo-env-minimalism). Mirrors
 * `supabase/config.toml` [storage] `file_size_limit = "50MiB"` and the `kb-media`
 * bucket's own `file_size_limit`. 50 MiB = 52428800 bytes.
 */
export const MAX_MEDIA_SIZE_BYTES = 52428800 as const;

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
 */
export const MEDIA_DOWNLOAD_URL_TTL_SECONDS = 10800 as const;
export const MEDIA_UPLOAD_URL_TTL_SECONDS = 120 as const;

/** The private bucket that holds KB media bytes (ADR-0026 §2a). */
export const KB_MEDIA_BUCKET = 'kb-media' as const;

/**
 * The satellite row shape — `kb.resource_media_meta` (ADR-0026 §4). 1:1 by
 * `nodeId`. `checksum`/`durationMs` are nullable generic extras (the per-kind
 * seam). `storagePath` is `spaces/<spaceId>/kb/<nodeId>/<serverKey>` — a
 * server-generated key, NEVER the raw filename (which is display-only metadata).
 */
export const resourceMediaMetaSchema = z.object({
  nodeId: z.string().min(1), // knr_… the owning node
  spaceId: z.string().min(1),
  storageBucket: z.string().min(1),
  storagePath: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().min(1), // display only; NEVER the storage path
  checksum: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
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
  sizeBytes: z.number().int().nonnegative(),
  filename: z.string().min(1),
});
export type MediaUploadAuthorizeRequest = z.infer<
  typeof mediaUploadAuthorizeRequestSchema
>;

/**
 * Upload-authorize response: the short-lived signed UPLOAD url the client PUTs
 * bytes to, plus the SERVER-decided `storagePath` the client must echo back on
 * confirm (`setResourceMedia`) so the satellite path matches the object. `token`
 * is the storage upload token (some clients use `uploadToSignedUrl`).
 */
export const mediaUploadAuthorizeResponseSchema = z.object({
  signedUrl: z.string().min(1),
  storagePath: z.string().min(1),
  token: z.string().min(1).optional(),
});
export type MediaUploadAuthorizeResponse = z.infer<
  typeof mediaUploadAuthorizeResponseSchema
>;

/**
 * The confirm/UPSERT input — written ONLY after a successful upload
 * (`attribute:'media'` on the attributes route → `setResourceMedia`). `createdBy`
 * is NOT here: it comes from the SESSION. `checksum`/`durationMs` are the nullable
 * generic extras.
 */
export const setResourceMediaRequestSchema = z.object({
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  storagePath: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  originalFilename: z.string().min(1),
  checksum: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
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
