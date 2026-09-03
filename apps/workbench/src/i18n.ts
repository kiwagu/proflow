import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import {
  createWorkbenchTranslator,
  loadWorkbenchMessages,
} from '@workspace/i18n-catalogs/workbench';
import { useEffect, useState } from 'react';

/**
 * Loads the workbench catalog once for the app's locale and hands back a
 * translator — the seam every app-level surface (chrome, boot screens,
 * document pane) reads its strings through. `null` while the catalog is
 * loading, which every caller here treats as "show the English default".
 */
export function useWorkbenchTranslator(): WorkbenchTranslator | null {
  const [t, setT] = useState<WorkbenchTranslator | null>(null);
  useEffect(() => {
    let cancelled = false;
    // The app has no locale switcher yet; English is the only wired
    // locale until one is added — the catalog itself already has ES.
    void loadWorkbenchMessages('en').then((messages) => {
      if (!cancelled) setT(() => createWorkbenchTranslator(messages));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return t;
}
