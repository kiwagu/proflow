import {
  type AgentWorkerClient,
  createAgentWorkerClient,
} from '@workspace/ai-agent';

export type { AgentWorkerClient };

/**
 * Starts the agent worker and returns the page's client for it.
 *
 * The worker takes the page's `?embedder=` choice as a query on its own URL:
 * a test that loads the page with `?embedder=hash` gets a worker whose
 * search tools run on the deterministic embedder too, and nothing has to
 * be plumbed through the protocol for it.
 */
export function startAgentWorker(options?: {
  /** Which embedder the worker should run; defaults to the page's query. */
  embedder?: string | null;
}): AgentWorkerClient {
  const workerUrl = new URL('./agent.worker.ts', import.meta.url);
  const embedder = options?.embedder ?? embedderFromPage();
  if (embedder) workerUrl.searchParams.set('embedder', embedder);
  return createAgentWorkerClient(new Worker(workerUrl, { type: 'module' }));
}

function embedderFromPage(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('embedder');
}
