import config from '@payload-config';
// This is the Payload EDIT surface: it loads `@payloadcms/next/css` (the full admin
// baseline, incl. the bundled Lexical typography) because it mounts the real Payload
// editor under `RootLayout`. The `/graph` READ surface DELIBERATELY does NOT load this
// — it is an independent shadcn surface, and Payload's global resets leak onto it (the
// command-palette focus frame, shrunk fonts). The reader instead mirrors the editor's
// Lexical CONTENT typography via the scoped `rich-content.css`
// (`app/graph/views/document-reader/`), so a body looks identical read↔edit WITHOUT
// dragging the admin baseline onto `/graph`. Do NOT "re-sync" the two CSS stacks.
import '../../author-tailwind.css';
import '@payloadcms/next/css';
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts';
import type { ServerFunctionClient } from 'payload';
import React from 'react';

import { importMap } from '../(payload)/admin/importMap.js';

/**
 * Root layout for the dedicated document-editor route (`/author/doc/[nodeId]`).
 *
 * It reuses Payload's OWN admin provider environment (`RootLayout` + the
 * `handleServerFunctions` server-function seam) so the real Payload Lexical
 * editor (`RenderLexical`) mounts here with ALL its features — slash menu, drag
 * handles, the "+" insert, every block — WITHOUT the admin navigation chrome.
 * Mirrors the generated `(payload)/layout.tsx` recipe (config + importMap +
 * serverFunction); the difference is only what renders inside (our clean editor
 * page, not the admin shell). A separate route group because `RootLayout` is a
 * root layout (it renders <html>/<body>) and cannot nest inside the workbench.
 */

const serverFunction: ServerFunctionClient = async function (args) {
  'use server';
  return handleServerFunctions({
    ...args,
    config,
    importMap,
  });
};

export default function DocEditorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RootLayout
      config={config}
      importMap={importMap}
      serverFunction={serverFunction}
    >
      {children}
    </RootLayout>
  );
}
