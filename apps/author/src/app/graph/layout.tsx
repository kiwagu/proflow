import type { ReactNode } from 'react';

import '../../author-tailwind.css';
// Load Payload's admin stylesheet on the READ side too, so the workbench and the
// document-editor route (which renders under Payload's `RootLayout`) share ONE
// baseline — the wrapper is then consistent read↔edit, and customisation starts
// from that consensus instead of fighting an asymmetric cascade. Keep this CSS
// stack identical to `app/(doc-editor)/layout.tsx` — diverging them re-introduces
// the drift (Payload's `html{font-size:13px}` + resets now apply to BOTH sides).
import '@payloadcms/next/css';

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
        <main className="bg-background text-foreground min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
