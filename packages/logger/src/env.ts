/**
 * Read env in Node, Deno edge, and (build-time) Vite/Next client where defined.
 */
export function readEnv(key: string): string | undefined {
  if (
    typeof process !== 'undefined' &&
    process.env &&
    typeof process.env[key] === 'string'
  ) {
    const v = process.env[key];
    return v !== '' ? v : undefined;
  }
  const g = globalThis as typeof globalThis & {
    Deno?: { env: { get(k: string): string | undefined } };
  };
  if (g.Deno?.env) {
    const v = g.Deno.env.get(key);
    return v !== '' ? v : undefined;
  }
  return undefined;
}

/** JSON lines to stdout; anything else uses Go-style human console lines. */
export function useJsonLogFormat(): boolean {
  const f = readEnv('LOG_FORMAT')?.toLowerCase();
  return f === 'json' || f === 'jsonl';
}
