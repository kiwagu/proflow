import type { ReactNode } from 'react';

import { TooltipProvider } from '@workspace/ui/components/tooltip';

import '../../author-tailwind.css';
// NO Payload admin CSS here on purpose. `/graph` is an INDEPENDENT shadcn consumer
// surface — it needs none of Payload's admin baseline: the chrome is `@workspace/ui`
// shadcn, and the inline document reader renders the Lexical body with Payload's
// `RichText` SERIALIZER (structure) + Tailwind `prose` (styling), neither of which
// needs `@payloadcms/next/css`. Loading it only leaked Payload's global resets (the
// `:focus-visible` admin outline, `html{font-size}`) onto shadcn and required cascade-
// layer/belt workarounds — so we don't load it. The Payload EDIT surface
// (`app/(doc-editor)/layout.tsx`) keeps `@payloadcms/next/css`: it renders the actual
// Payload editor under RootLayout and genuinely needs it.

/**
 * Root layout for the knowledge-graph CONSUMER render surface (`/author/graph/*`
 * pages). This is a shadcn surface (`@workspace/ui` theme, ADR-0005 §7 — END-USER
 * read, not the Payload operator admin), so it pulls the shared Tailwind/shadcn
 * theme and is intentionally separate from the `(payload)` admin layout.
 */
export const metadata = {
  title: 'Knowledge',
};

export default function GraphLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Single TooltipProvider at the workbench root — the canonical Radix
            shape (the provider "wraps your app"). All `Hint`s below share it,
            so they get one consistent open delay + skip-delay grouping. */}
        <TooltipProvider>
          <main className="bg-background text-foreground min-h-screen">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
