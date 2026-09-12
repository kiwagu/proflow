import {
  type AgentWorkerClient,
  createAgentWorkerClient,
} from '@workspace/ai-agent';

export type { AgentWorkerClient };

export interface AgentWorkerOptions {
  /** Which embedder the worker should run; defaults to the page's query. */
  embedder?: string | null;
  /**
   * Which local database the worker should open — the page's own, so the
   * agent's tools read the documents the user is looking at rather than a
   * second, empty database beside them. Omitted means the worker's default.
   */
  namespace?: string;
}

/**
 * Starts the agent worker and returns the page's client for it.
 *
 * The worker is configured entirely through its own URL: a test that loads
 * the page with `?embedder=hash` gets a worker whose search tools run on
 * the deterministic embedder too, and the page's database namespace rides
 * across the same way. Nothing has to be plumbed through the protocol, and
 * neither setting can arrive after the worker has already opened.
 *
 * The URL itself is built here, inline, and deliberately so: the bundler
 * finds and bundles the worker by recognising this exact
 * `new URL('./agent.worker.ts', import.meta.url)` form beside the worker
 * file. A path assembled from a variable, or moved to another module,
 * fails to resolve in a build while types and unit tests stay green.
 */
export function startAgentWorker(
  options?: AgentWorkerOptions
): AgentWorkerClient {
  const workerUrl = configureWorkerUrl(
    new URL('./agent.worker.ts', import.meta.url),
    {
      namespace: options?.namespace,
      embedder: options?.embedder ?? embedderFromPage(),
    }
  );
  return createAgentWorkerClient(new Worker(workerUrl, { type: 'module' }));
}

/**
 * Writes the worker's settings onto the URL it is given.
 *
 * Takes a ready `URL` rather than building one, so the literal above stays
 * where the bundler can see it.
 */
export function configureWorkerUrl(
  workerUrl: URL,
  options: AgentWorkerOptions
): URL {
  if (options.embedder)
    workerUrl.searchParams.set('embedder', options.embedder);
  if (options.namespace)
    workerUrl.searchParams.set('namespace', options.namespace);
  return workerUrl;
}

function embedderFromPage(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('embedder');
}
