/**
 * Rejects protocol-relative and non-path values to avoid open redirects.
 */
export function safeNextPath(raw: string | null): string | null {
  if (raw == null || raw === '') {
    return null;
  }
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }
  return raw;
}

/**
 * Resolves `next` query: safe path or default for the app shell.
 */
export function resolvedNextPath(
  raw: string | null,
  defaultPath: string
): string {
  return safeNextPath(raw) ?? defaultPath;
}
