/**
 * Browser-safe entry: no `node:async_hooks`. Prefer `logger.child({ requestId })` for correlation.
 */
export type { LogContext, LogLevelName, Logger } from './types.js';
export { readEnv, useJsonLogFormat } from './env.js';
export { getProcessId } from './pid.js';
export { normalizeLogLevel, resolveLogLevel } from './resolve-level.js';
export { formatGoLikeLine } from './go-format.js';
export { logRequestTrace } from './trace.js';
export { createLogger, setLogLevel } from './create-logger-browser.js';

import type { LogContext } from './types.js';

export function withLogContext<T>(_ctx: LogContext, fn: () => T): T {
  return fn();
}

export function getLogContext(): LogContext | undefined {
  return undefined;
}
