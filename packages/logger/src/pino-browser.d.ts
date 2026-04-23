declare module 'pino/browser.js' {
  import type { Logger, LoggerOptions } from 'pino';

  function pino(opts?: LoggerOptions): Logger;
  export default pino;
}
