import type { ReactNode } from 'react';

/** `'/'` = web shell; `'/author'` must match `NEXT_PUBLIC_GATEWAY_AUTHOR_PATH` (default `/author`). */
export type GatewayExternalHref = '/' | '/author';

/**
 * Same-origin routes served by another app (e.g. web at `/`, author under the gateway author prefix).
 * Renders a real `<a>` for a full document navigation. In Next.js, `next/link` with
 * `href="/"` resolves under the current app's `basePath`, so use this at gateway boundaries.
 */
export function ExternalGatewayLink({
  href,
  children,
  className,
}: {
  href: GatewayExternalHref;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
