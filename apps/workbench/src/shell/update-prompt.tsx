import { Button } from '@workspace/ui/components/button';
import { useWorkbenchTranslator } from '../i18n';

/**
 * Offered when a newer build of the app is installed and waiting.
 *
 * The waiting build is never applied on its own. The local database is
 * exclusive to one page at a time, so a silent takeover would leave a new
 * build's code talking to a database the previous build's page still holds
 * — which surfaces as the app refusing to start ("close any other tab").
 * Taking the update means reloading, and only the user knows when that is
 * a good moment.
 */
export function UpdatePrompt({ onApply }: { onApply: () => void }) {
  const t = useWorkbenchTranslator();
  if (!t) return null;
  return (
    <div
      role="status"
      data-testid="workbench-update-prompt"
      className="bg-popover text-popover-foreground fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-md"
    >
      <span>{t('workbench.app.update.available')}</span>
      <Button size="sm" onClick={onApply} data-testid="workbench-update-apply">
        {t('workbench.app.update.reload')}
      </Button>
    </div>
  );
}
