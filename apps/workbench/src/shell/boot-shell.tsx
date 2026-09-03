import { useEffect, useState } from 'react';
import { pendingBootSteps } from '../composition/root';
import { useWorkbenchTranslator } from '../i18n';
import { SIDEBAR_WIDTH } from './layout';

/**
 * The app's frame, rendered before its services exist. Boot opens a local
 * database, and on a device with a lot stored that takes seconds — seconds
 * that used to be a centered spinner on a blank page. The shell shows the
 * layout the user is waiting for instead: the same chrome and panel widths
 * the real app will mount with, so the finished app appears as content
 * filling an already-familiar frame rather than as a different page.
 *
 * No service is available here, and nothing in this component may reach
 * for one: it renders from static markup only.
 */

/** How long a boot may stay quiet before the shell starts explaining. */
const EXPLAIN_AFTER_MS = 8_000;

function PanelGlimmer() {
  return (
    <div className="flex flex-col gap-2 p-4" aria-hidden="true">
      <div className="bg-muted h-3 w-2/3 animate-pulse rounded" />
      <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
      <div className="bg-muted h-3 w-3/5 animate-pulse rounded" />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BootShell() {
  const [explain, setExplain] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const t = useWorkbenchTranslator();

  useEffect(() => {
    const slow = setTimeout(() => {
      setExplain(true);
      setSteps(pendingBootSteps());
    }, EXPLAIN_AFTER_MS);
    const poll = setInterval(() => setSteps(pendingBootSteps()), 500);
    return () => {
      clearTimeout(slow);
      clearInterval(poll);
    };
  }, []);

  return (
    <div className="bg-background text-foreground flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-[14px] border-b px-4">
        <div className="flex items-center gap-[9px]">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground grid size-[26px] place-items-center rounded-md text-xs font-bold"
          >
            P
          </span>
          <span className="text-base font-bold tracking-tight">
            {t ? t('workbench.app.brand') : 'ProFlow'}
          </span>
        </div>
      </header>
      <main className="flex min-h-0 flex-1">
        <nav
          className="bg-sidebar flex shrink-0 flex-col border-r"
          style={{ width: `${SIDEBAR_WIDTH}px` }}
        >
          <PanelGlimmer />
        </nav>
        <section className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3">
          <Spinner className="text-muted-foreground animate-spin" />
          <p className="text-muted-foreground text-sm" role="status">
            {explain
              ? t
                ? t('workbench.app.boot.stillStarting')
                : 'Still starting…'
              : t
                ? t('workbench.app.boot.starting')
                : 'Starting the workbench…'}
          </p>
          {explain ? (
            <>
              {steps.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t
                    ? t('workbench.app.boot.waitingFor', {
                        steps: steps.join(' and '),
                      })
                    : `Waiting for ${steps.join(' and ')}.`}
                </p>
              ) : null}
              <p className="text-muted-foreground/70 max-w-md text-center text-xs">
                {t
                  ? t('workbench.app.boot.slowHint')
                  : 'A device with a lot stored takes longer to open. If another tab has the workbench open, closing it can help — the tabs share one database.'}
              </p>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
