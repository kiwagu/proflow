import pino from 'pino/browser.js';
import { useJsonLogFormat } from './env.js';
import { formatGoLikeLine } from './go-format.js';
import { normalizeLogLevel, resolveLogLevel } from './resolve-level.js';
import { getProcessId } from './pid.js';
import type { Logger } from './types.js';

let rootLogger: Logger | null = null;

function getOrCreateRoot(): Logger {
  if (!rootLogger) {
    const json = useJsonLogFormat();
    rootLogger = pino({
      level: resolveLogLevel(),
      base: undefined,
      browser: {
        write: (o: object) => {
          const raw = o as Record<string, unknown>;
          const rec = { ...raw, pid: raw.pid ?? getProcessId() };
          if (json) {
            console.log(JSON.stringify(rec));
          } else {
            console.log(formatGoLikeLine(rec));
          }
        },
      },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
    }) as Logger;
  }
  return rootLogger;
}

export function createLogger(
  bindings?: { name?: string } & Record<string, unknown>
): Logger {
  const root = getOrCreateRoot();
  if (bindings && Object.keys(bindings).length > 0) {
    return root.child(bindings);
  }
  return root;
}

export function setLogLevel(level: string): void {
  const normalized = normalizeLogLevel(level);
  if (!normalized) {
    return;
  }
  getOrCreateRoot().level = normalized;
}
