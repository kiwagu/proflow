'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

const noopSubscribe = () => () => {};

/**
 * Payload 3 list views combine RSC output with client-only behavior (e.g. dnd-kit / list controls):
 * the first client render sets `disabled={true}` on pills and row checkboxes while SSR emitted
 * `disabled={null}`, which triggers React hydration warnings in dev.
 *
 * Deferring the admin subtree until the client snapshot avoids that mismatch. `useSyncExternalStore`
 * uses `getServerSnapshot` during SSR/hydration (false) then `getSnapshot` on the client (true) —
 * no `useEffect` + setState (avoids cascading-render lint / compiler warnings). Admin has no SEO
 * requirement. If warnings persist, rule out browser extensions (https://react.dev/link/hydration-mismatch).
 */
export function AdminClientMount({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  if (!isClient) {
    return (
      <div
        className="payload-admin-hydration-placeholder"
        style={{
          minHeight: '45vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.875rem',
          opacity: 0.7,
        }}
      >
        Loading admin…
      </div>
    );
  }
  return children;
}
