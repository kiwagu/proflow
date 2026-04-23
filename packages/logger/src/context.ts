import { AsyncLocalStorage } from 'node:async_hooks';
import type { LogContext } from './types.js';

const als = new AsyncLocalStorage<LogContext>();

/**
 * AsyncLocalStorage-backed context (Node + Deno node:async_hooks). Use for requestId and trace fields.
 * In the browser bundle (`@workspace/logger/client`), this is a no-op store.
 */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getLogContext(): LogContext | undefined {
  return als.getStore();
}
