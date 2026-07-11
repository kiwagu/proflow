/**
 * sendJson — the shared fetch helper for the ResourcePanel module's mutating
 * routes (description save, version create-draft/publish/delete). POST/PATCH/DELETE
 * a JSON body to an RLS-gated route; returns `res.ok`. Mechanism only — RLS is the
 * authority.
 */
export async function sendJson(
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST'
): Promise<boolean> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/**
 * postJson — the `sendJson` sibling that RETURNS the parsed JSON body (typed by the
 * caller) instead of just `res.ok`. For routes whose response is load-bearing — the
 * media download-authorize returns the short-lived signed URL the client must
 * navigate to. Returns `null` on a non-2xx (RLS/authorize denial) or a parse
 * failure, so the caller fail-closes to "no URL" — never a leak, never a throw.
 */
export async function postJson<T>(
  path: string,
  body: unknown
): Promise<T | null> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return null;
  }
  return (await res.json().catch(() => null)) as T | null;
}
