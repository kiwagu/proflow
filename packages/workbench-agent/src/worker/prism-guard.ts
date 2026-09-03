/// <reference lib="webworker" />
/**
 * The syntax highlighter bundled with the code-block node support installs a
 * `message` handler on any worker it loads into and JSON-parses every message
 * it sees — it assumes the worker exists to highlight code for a page. The
 * agent worker's messages are structured objects, not for it, and every one
 * would surface as an uncaught "is not valid JSON" error. The highlighter
 * reads this flag from a pre-existing global before installing anything, so
 * this module must be the worker entry's FIRST import.
 */
(self as unknown as { Prism?: object }).Prism = {
  disableWorkerMessageHandler: true,
  manual: true,
};
