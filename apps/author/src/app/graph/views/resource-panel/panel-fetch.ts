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
