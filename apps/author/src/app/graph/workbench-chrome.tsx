'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { WorkbenchChrome as WorkbenchChromeShell } from '@workspace/ui/components/platform/workbench-chrome';
import * as React from 'react';

/**
 * WorkbenchChrome — the app i18n binding over the presentational
 * `@workspace/ui` platform shell. It maps the graph catalog into the shell's copy
 * props, so the shared workbench wrapper (top bar + explainer strip) stays in the
 * UI library while the domain wiring (the `Drive` variant labels) stays here.
 * Rendered by both the Drive workbench host and the document-editor route.
 */
export function WorkbenchChrome({
  messages,
  actions,
}: {
  messages: Record<string, string>;
  /** Optional right-aligned top-bar actions (e.g. the command-palette trigger). */
  actions?: React.ReactNode;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  return (
    <WorkbenchChromeShell
      brand={t('graph.topbar.brand')}
      tabLabel={t('graph.variant.drive')}
      note={{
        label: t('graph.variant.drive'),
        text: t('graph.variant.driveNote'),
      }}
      actions={actions}
    />
  );
}
