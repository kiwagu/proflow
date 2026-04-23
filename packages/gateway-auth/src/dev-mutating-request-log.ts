import type { NextRequest } from 'next/server';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseTruthyEnv(value: string | undefined): boolean {
  if (value === undefined || value === '') {
    return false;
  }
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * When set in `.env` (e.g. `DEV_FULL_REQUEST_LOG=true`), Next.js dev logs every incoming
 * request (default framework behavior) and `logMutatingRequestInDev` does nothing to avoid duplicates.
 */
export function isDevFullRequestLoggingEnabled(): boolean {
  return parseTruthyEnv(process.env.DEV_FULL_REQUEST_LOG);
}

/**
 * Dev-only one-line log for mutating requests. Use with `logging.incomingRequests: false`
 * so the terminal is not filled with GET/HEAD/RSC traffic.
 */
export function logMutatingRequestInDev(request: NextRequest): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  if (isDevFullRequestLoggingEnabled()) {
    return;
  }
  if (!MUTATING_METHODS.has(request.method)) {
    return;
  }
  const u = request.nextUrl;
  const path = `${u.pathname}${u.search}`;
  console.log(`${request.method} ${path}`);
}
