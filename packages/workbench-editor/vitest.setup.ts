import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Without globals the library's own auto-cleanup never registers, and one
// case's DOM is still mounted while the next one queries.
afterEach(cleanup);

// jsdom ships neither ResizeObserver nor the pointer-capture surface the
// Radix positioning/dismissal layers probe for. Stub just enough that a
// popover can open and close in tests; nothing asserts on geometry.
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
  const proto = Element.prototype as Element & {
    hasPointerCapture?: (id: number) => boolean;
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
}
