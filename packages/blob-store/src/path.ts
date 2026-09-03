/**
 * Normalizes a path inside a package, or returns null when it cannot be
 * confined: absolute paths, URL schemes, and any `..` segment are refused
 * outright rather than resolved — content asking for them is asking for
 * something it must not get.
 */
export function confinePath(raw: string): string | null {
  let path = raw;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.startsWith('/') || path.startsWith('\\')) return null;
  const segments = path
    .split(/[\\/]+/)
    .filter((s) => s.length > 0 && s !== '.');
  if (segments.some((s) => s === '..')) return null;
  if (segments.length === 0) return null;
  return segments.join('/');
}
