import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without globals the library's own auto-cleanup never registers, and one
// case's DOM is still mounted while the next one queries.
afterEach(cleanup);

// jsdom ships no ResizeObserver, which cmdk's list measures itself with.
// Stub just enough that a command list can mount; nothing asserts geometry.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    ResizeObserverStub;
}

if (typeof Element !== 'undefined') {
  const proto = Element.prototype as Element & { scrollIntoView?: () => void };
  proto.scrollIntoView ??= () => {};
}
