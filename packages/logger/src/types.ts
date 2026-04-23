import type { Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

export type LogContext = {
  requestId?: string;
  [key: string]: unknown;
};

export type LogLevelName =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'silent';
