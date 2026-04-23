/**
 * Process id for log correlation (Node, Deno). Browser / unknown: `-`.
 */
export function getProcessId(): number | string {
  if (typeof process !== 'undefined' && typeof process.pid === 'number') {
    return process.pid;
  }
  const g = globalThis as typeof globalThis & { Deno?: { pid: number } };
  if (typeof g.Deno !== 'undefined' && typeof g.Deno.pid === 'number') {
    return g.Deno.pid;
  }
  return '-';
}
