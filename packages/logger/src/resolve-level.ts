import { readEnv } from './env.js';
import type { LogLevelName } from './types.js';

const ALLOWED = new Set<LogLevelName>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

export function normalizeLogLevel(level: string): LogLevelName | undefined {
  const l = level.toLowerCase() as LogLevelName;
  return ALLOWED.has(l) ? l : undefined;
}

/**
 * LOG_LEVEL wins when set and valid.
 * Otherwise: production → warn, else → info (typical dev default).
 */
export function resolveLogLevel(): LogLevelName {
  const explicit = readEnv('LOG_LEVEL')?.toLowerCase() as
    | LogLevelName
    | undefined;
  if (explicit && ALLOWED.has(explicit)) {
    return explicit;
  }
  const nodeEnv = readEnv('NODE_ENV')?.toLowerCase();
  if (nodeEnv === 'production') {
    return 'warn';
  }
  return 'info';
}
