/**
 * What the page tells its worker, and how.
 *
 * The worker is configured entirely through its own URL — there is no
 * handshake to plumb a setting through — so these cases are about the one
 * thing that decides whether the agent looks at the user's data or at an
 * empty database: the namespace of the database the worker opens.
 */
import { describe, expect, it } from 'vitest';
import { configureWorkerUrl } from './start';

const BASE = 'https://app.example/assets/agent.worker.js';

describe('the agent worker URL', () => {
  it('carries the namespace of the database the page opened', () => {
    const url = configureWorkerUrl(new URL(BASE), {
      namespace: 'proflow-user-space',
      embedder: null,
    });
    expect(url.searchParams.get('namespace')).toBe('proflow-user-space');
  });

  it('leaves the namespace off when the caller names none', () => {
    // No namespace means the worker's own default, which is what a page
    // with no session (a test harness) wants.
    const url = configureWorkerUrl(new URL(BASE), { embedder: null });
    expect(url.searchParams.has('namespace')).toBe(false);
  });

  it('keeps carrying the embedder choice beside it', () => {
    const url = configureWorkerUrl(new URL(BASE), {
      embedder: 'hash',
      namespace: 'proflow-user-space',
    });
    expect(url.searchParams.get('embedder')).toBe('hash');
    expect(url.searchParams.get('namespace')).toBe('proflow-user-space');
  });

  it('configures the URL it is given rather than rebuilding one', () => {
    // The literal `new URL('./agent.worker.ts', import.meta.url)` in the
    // caller is what the bundler finds the worker by; a helper that built
    // its own path would resolve to nothing in a build while every test
    // stayed green.
    const url = configureWorkerUrl(new URL(BASE), { namespace: 'ns' });
    expect(url.pathname).toBe('/assets/agent.worker.js');
  });
});
