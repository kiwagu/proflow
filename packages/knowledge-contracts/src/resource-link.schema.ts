import { z } from 'zod';

/**
 * KB link satellite contracts (slice-10 §2.4). A `kind='link'` node becomes REAL
 * by pairing the bodyless `knowledge_resources` node with an external URL in the
 * 1:1 `kb.resource_link` satellite (prefix `krl`).
 *
 * SCHEME ALLOW-LIST (anti stored-XSS): the URL renders as an `<a href>`, so ONLY
 * http/https pass — `javascript:`, `data:` and every other scheme are rejected at
 * the boundary (and again by the DB CHECK `resource_link_http_only`). The server
 * NEVER dereferences the URL (no unfurl/favicon this slice) — no SSRF surface.
 */

/** Mirrors the DB CHECK `resource_link_url_length`. */
export const LINK_URL_MAX_LENGTH = 2048;

/** An absolute external URL, http(s)-only — the single URL validation authority
 * (client pre-validation, the attributes route, and the seed all use it). */
export const linkUrlSchema = z
  .url({ protocol: /^https?$/ })
  .trim()
  .max(LINK_URL_MAX_LENGTH);

/**
 * The display host for the card meta line / panel (e.g. "status.acme.com") —
 * derived SERVER-SIDE from the validated URL at write time, denormalized onto the
 * satellite row so readers never parse the URL. Null only for a value that does
 * not parse (unreachable after `linkUrlSchema`, but total by construction).
 */
export function deriveLinkHost(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

/**
 * The `attribute:'link'` UPSERT input on the attributes route → `setResourceLink`
 * (same shape family as description/media). `host` is NOT here — the server
 * derives it; `createdBy` comes from the SESSION, never the body.
 */
export const setResourceLinkRequestSchema = z.object({
  spaceId: z.string().min(1),
  nodeId: z.string().min(1),
  url: linkUrlSchema,
});
export type SetResourceLinkRequest = z.infer<
  typeof setResourceLinkRequestSchema
>;

export function parseSetResourceLinkRequest(raw: unknown) {
  return setResourceLinkRequestSchema.safeParse(raw);
}
