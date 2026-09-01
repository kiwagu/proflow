'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible';
import { cn } from '@workspace/ui/lib/utils';
import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const STORAGE_PREFIX = 'workbench:files:section-open:';

/** Local changes need their own notification: `storage` only fires cross-tab. */
const listeners = new Set<() => void>();
function announce() {
  for (const listener of listeners) listener();
}

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) !== 'false';
  } catch {
    // Storage can be denied outright (private modes, blocked third-party
    // contexts). A section that cannot remember still has to open.
    return true;
  }
}

function write(key: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(open));
  } catch {
    // Not remembering is a smaller failure than refusing to collapse.
  }
  announce();
}

/**
 * The remembered open state of one section.
 *
 * Storage is an external system, so it is subscribed to rather than
 * mirrored into state — which also makes the server snapshot explicit:
 * a first paint with no storage renders open, and the client's own value
 * takes over on hydration without a render-phase read.
 */
function usePersistedOpen(key: string): [boolean, (next: boolean) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    window.addEventListener('storage', onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  const getSnapshot = useCallback(() => read(key), [key]);
  const open = useSyncExternalStore(subscribe, getSnapshot, () => true);
  const setOpen = useCallback((next: boolean) => write(key, next), [key]);
  return useMemo(() => [open, setOpen], [open, setOpen]);
}

/**
 * A sidebar section with a collapsible body. The open state is persisted
 * per section, so the sidebar comes back the way it was left.
 */
export function CollapsibleSection({
  label,
  persistKey,
  headerAction,
  testId,
  children,
}: {
  label: string;
  persistKey: string;
  headerAction?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistedOpen(persistKey);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/section flex w-full flex-col"
      data-testid={testId}
    >
      <div className="relative">
        <CollapsibleTrigger
          className={cn(
            'flex h-7 w-full min-w-0 items-center justify-start gap-1 rounded-md px-2 text-left text-[13px] font-medium text-muted-foreground/70 transition-colors hover:bg-muted hover:text-muted-foreground',
            headerAction ? 'pr-18' : 'pr-2'
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3 shrink-0 transition-transform duration-[120ms] ease-in-out',
              !open && '-rotate-90'
            )}
          />
        </CollapsibleTrigger>
        {headerAction ? (
          <div className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
            {headerAction}
          </div>
        ) : null}
      </div>
      <CollapsibleContent className="mt-0.5">
        <div className="flex min-h-0 flex-col gap-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
