/**
 * Directory keyset cursor — opaque encode/decode for `space_member_directory` paging.
 * The cursor carries the LAST seen row's stable sort position
 * `(k, u)` where `k = coalesce(nullif(btrim(display_name),''), email)` and `u = user_id`.
 * The DB resumes the total order strictly AFTER this tuple — a drift-free keyset seek.
 *
 * Encoding (normative): `base64url(json({ k, u }))`. The token is OPAQUE to
 * the client (never parsed there); the fanout decodes it into the two plain function
 * params `(p_after_key, p_after_user)`, keeping the DB contract simple + the codec
 * testable. A null/blank/malformed cursor decodes to `null` = first page (fail-soft — a
 * picker cursor is NOT a security boundary; the membership fence in the function is).
 *
 * The cursor does NOT encode the query: a new query string is page 1 (the client debounce
 * resets it), so the caller re-sends `q` with every page and starts each query at cursor
 * `null`.
 */

/** The decoded keyset position of the last row of the previous page. */
export type DirectoryCursor = {
  /** sort_key = coalesce(nullif(btrim(display_name),''), email) of the last row. */
  k: string;
  /** user_id (uuid) of the last row — the unique tiebreaker. */
  u: string;
};

/** base64url (RFC 4648 §5) — URL-safe, unpadded; what the opaque token uses. */
function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(token: string): string {
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

/** Encode a keyset position into the opaque cursor token. */
export function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return toBase64Url(JSON.stringify({ k: cursor.k, u: cursor.u }));
}

/**
 * Decode an opaque cursor token into its keyset position. Returns `null` for a
 * null/blank/malformed token (fail-soft → first page). A well-formed token must carry
 * BOTH a string `k` and a non-empty string `u`; anything else is treated as first page.
 */
export function decodeDirectoryCursor(
  token: string | null | undefined
): DirectoryCursor | null {
  if (token == null || token.trim() === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(fromBase64Url(token.trim())) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'k' in parsed &&
      'u' in parsed &&
      typeof (parsed as { k: unknown }).k === 'string' &&
      typeof (parsed as { u: unknown }).u === 'string' &&
      (parsed as { u: string }).u !== ''
    ) {
      const { k, u } = parsed as { k: string; u: string };
      return { k, u };
    }
    return null;
  } catch {
    return null;
  }
}
