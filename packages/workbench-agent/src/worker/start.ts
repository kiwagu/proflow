import {
  type AgentPagePorts,
  type AgentWorkerClient,
  createAgentWorkerClient,
} from '@workspace/ai-agent';

export type { AgentWorkerClient };

/**
 * Starts the agent worker and returns the page's client for it.
 *
 * The literal `new URL('./agent.worker.ts', import.meta.url)` stands as the
 * DIRECT argument of `new Worker(...)`, and must stay that way: that exact
 * form is how the bundler recognises a worker. Behind a variable, or wrapped
 * in a call, it emits no worker chunk — the module is inlined as an
 * untranspiled `data:` URL that cannot resolve its own imports, and nothing
 * fails until a built page tries to start the worker.
 *
 * Nothing rides on the URL either. A query there is worse than useless: the
 * dev server picks its loader from the extension it reads off the URL, and a
 * dot in a query value reads as the start of a new one — so
 * `?namespace=spc_x.01m2…` stopped the file being TypeScript and it was
 * parsed as JavaScript, dying on its first `import type`. Entity ids are
 * dotted by construction, so that dot was a guarantee, not bad luck.
 *
 * The worker needs no configuration in any case: it opens no database. Every
 * port it serves the agent over is a proxy back to `ports` here, because the
 * local database is exclusive and the page owns the only client.
 */
export function startAgentWorker(ports: AgentPagePorts): AgentWorkerClient {
  const worker = new Worker(new URL('./agent.worker.ts', import.meta.url), {
    type: 'module',
  });
  return createAgentWorkerClient(worker, ports);
}
