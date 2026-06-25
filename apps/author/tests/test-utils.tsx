import * as React from 'react';
import {
  render as rtlRender,
  type RenderOptions,
} from '@testing-library/react';

import { TooltipProvider } from '@workspace/ui/components/tooltip';

/**
 * AllProviders — the app-level context the workbench components assume at runtime,
 * mirrored for tests. Today that's the single `TooltipProvider` the graph layout
 * mounts at its root (the canonical Radix shape — one provider wraps the app, so
 * every `Hint` shares its delay/skip-delay grouping). New cross-cutting providers
 * (theme, i18n, …) belong HERE, so specs never re-declare provider plumbing.
 */
function AllProviders({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

/**
 * Drop-in for `@testing-library/react`'s `render` that wraps the UI in `AllProviders`.
 * Import `render`/`screen`/… from this module instead of the library directly so
 * component specs render in the same provider context as the app (RTL's recommended
 * custom-render pattern). A per-call `wrapper` still overrides when a test needs it.
 */
function render(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return rtlRender(ui, { wrapper: AllProviders, ...options });
}

// Re-export the rest of RTL; the explicit `render` above shadows the library's.
export * from '@testing-library/react';
export { render };
