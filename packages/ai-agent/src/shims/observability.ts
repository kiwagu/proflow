/**
 * Tracing, local edition.
 *
 * The editing session is instrumented with spans. There is no collector in
 * the browser, so a span is a name and a set of attributes that go nowhere;
 * the call sites keep their shape and their timing structure.
 */
export interface Span {
  setAttr(key: string, value: unknown): void;
  error(error: unknown): void;
  end(): void;
  span(name: string): Span;
}

const noopSpan: Span = {
  setAttr() {},
  error() {},
  end() {},
  span() {
    return noopSpan;
  },
};

function span(name: string): Span;
function span<T>(name: string, fn: (span: Span) => T): T;
function span<T>(_name: string, fn?: (span: Span) => T): Span | T {
  return fn ? fn(noopSpan) : noopSpan;
}

export const Telemetry = { span };
