import config from '@payload-config';
// SHARED BASELINE: this exact CSS stack (author-tailwind THEN @payloadcms/next/css)
// is also loaded by the workbench read surface `app/graph/layout.tsx`, so the
// shared `WorkbenchChrome` + toolbars render identically read↔edit. Keep the two
// in sync — diverging the stacks re-introduces the read↔edit drift.
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
