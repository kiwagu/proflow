import { Writable } from 'node:stream';
import pino, { type LoggerOptions } from 'pino';
import { useJsonLogFormat } from './env.js';
import { formatGoLikeLine } from './go-format.js';
import { normalizeLogLevel, resolveLogLevel } from './resolve-level.js';
import { getLogContext } from './context.js';
import { getProcessId } from './pid.js';
import type { Logger } from './types.js';

function createDestination(): Writable {
  const json = useJsonLogFormat();
  return new Writable({
    write(chunk: Buffer | string, _encoding, cb) {
      const line = typeof chunk === 'string' ? chunk : chunk.toString();
      const trimmed = line.trimEnd();
      if (json) {
        console.log(trimmed);
      } else {
        try {
          const rec = JSON.parse(trimmed) as Record<string, unknown>;
          console.log(formatGoLikeLine(rec));
        } catch {
          console.log(trimmed);
        }
      }
      cb();
    },
  });
}

function baseOptions(): LoggerOptions {
  return {
    level: resolveLogLevel(),
    base: undefined,
    mixin() {
      const ctx = getLogContext();
      const out: Record<string, unknown> = { pid: getProcessId() };
      if (ctx?.requestId) {
        out.requestId = ctx.requestId;
      }
      return out;
    },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
    },
  };
}

let rootLogger: Logger | null = null;

function getOrCreateRoot(): Logger {
  if (!rootLogger) {
    rootLogger = pino(baseOptions(), createDestination());
  }
  return rootLogger;
}

/**
 * Returns the shared root logger or a child with `bindings` (e.g. `{ name: 'identity_fanout' }`).
 * Level is read from LOG_LEVEL, else NODE_ENV (production → warn, otherwise info).
 */
export function createLogger(
  bindings?: { name?: string } & Record<string, unknown>
): Logger {
  const root = getOrCreateRoot();
  if (bindings && Object.keys(bindings).length > 0) {
    return root.child(bindings);
  }
  return root;
}

/**
 * Override level at runtime (e.g. future admin UI). Applies to the shared root and all children.
 */
export function setLogLevel(level: string): void {
  const normalized = normalizeLogLevel(level);
  if (!normalized) {
    return;
  }
  getOrCreateRoot().level = normalized;
}
