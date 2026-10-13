/**
 * The app's own `render` for component specs.
 *
 * Hints (`Hint`) read a tooltip provider from context and throw without one,
 * so every spec that mounts a control with a hint would otherwise have to
 * wrap its tree by hand — and each such wrapper is one more place where the
 * app's composition and the test's composition can drift apart. Specs import
 * `render` from here instead of from the library directly; the provider lives
 * in exactly one place, the same way the app mounts exactly one at its root.
 *
 * Re-exports the rest of the library so a spec needs a single import.
 */
import {
  render as libraryRender,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { TooltipProvider } from '@workspace/ui/components/tooltip';
import type { ReactElement, ReactNode } from 'react';

/** Everything a mounted component may expect to find above it. */
function Providers({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

/**
 * Mounts `ui` under the app's providers. `rerender` from the returned result
 * keeps them, so a spec never re-states the wrapper.
 */
function render(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult {
  return libraryRender(ui, { wrapper: Providers, ...options });
}

export * from '@testing-library/react';
export { render };
