import type { ReactNode } from 'react';

import '../../author-tailwind.css';

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
