import type { Logger } from './types.js';

/**
 * Emit a single debug line for request/workflow tracing. Visible when level is debug or trace.
 */
export function logRequestTrace(
  logger: Logger,
  step: string,
  detail?: Record<string, unknown>
): void {
  if (detail) {
    logger.debug(detail, step);
  } else {
    logger.debug(step);
  }
}
