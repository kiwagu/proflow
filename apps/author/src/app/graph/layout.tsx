import type { ReactNode } from 'react';

import '../../author-tailwind.css';

/**
 * Root layout for the knowledge-graph CONSUMER render surface (`/author/graph/*`
 * pages). This is a shadcn surface (`@workspace/ui` theme, ADR-0005 §7 — END-USER
 * read, not the Payload operator admin), so it pulls the shared Tailwind/shadcn
 * theme and is intentionally separate from the `(payload)` admin layout.
 *
 * Full-bleed: this segment owns its own `<html>`/`<body>` (there is NO external
 * author sidebar/chrome around `/author/graph`), so it is the FULL viewport. The
 * body has no margin and `main` fills the screen (`h-dvh`, no max-width, no
 * centering) — the workbench shell takes the whole area (slice-11 layout fix).
 */
export const metadata = {
  title: 'Knowledge',
};

export default function GraphLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="m-0">
        <main className="bg-background text-foreground h-dvh overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
