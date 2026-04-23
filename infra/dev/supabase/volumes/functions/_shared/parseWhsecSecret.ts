/**
 * Parses GoTrue / Standard Webhooks symmetric secret from env (e.g. `v1,whsec_...`).
 */
export function parseWhsecSecret(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] ?? '';
  const segment = first.includes(',') ? first.split(',').slice(1).join(',') : first;
  if (!segment.startsWith('whsec_')) {
    throw new Error(
      'Hook secrets must include a whsec_ signing secret (e.g. v1,whsec_<base64>)'
    );
  }
  return segment;
}
