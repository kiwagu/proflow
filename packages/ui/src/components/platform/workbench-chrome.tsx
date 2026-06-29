import {
  SegmentedControl,
  SegmentedControlButton,
} from '@workspace/ui/components/segmented-control';
import { cn } from '@workspace/ui/lib/utils';
import { FolderTree, Info } from 'lucide-react';
import * as React from 'react';

/**
 * WorkbenchChrome — the workbench wrapper shell (56px top bar: brand mark + a
 * single active tab; plus the explainer strip below it). PLATFORM-flavoured but
 * PRESENTATION-only: all copy is passed in, so it carries NO i18n/domain
 * dependency and can be shared across surfaces (e.g. the Drive workbench and the
 * dedicated document-editor route render the same shell).
 *
 * Lives under `components/platform/` — app-flavoured shared UI, kept apart from
 * the domain-neutral shadcn primitives in `components/`.
 */

export type WorkbenchChromeProps = {
  /** Brand wordmark (e.g. "ProFlow"). */
  brand: string;
  /** Single-character brand badge; defaults to the brand's first letter. */
  brandMark?: string;
  /** The active tab's label. */
  tabLabel: string;
  /** The explainer strip: a bold lead-in label + the descriptive text. */
  note: { label: string; text: string };
  /** Optional right-aligned actions in the top bar (e.g. a command-palette trigger).
   * Presentation-only — the host owns the action's behaviour + i18n. */
  actions?: React.ReactNode;
  className?: string;
};

export function WorkbenchChrome({
  brand,
  brandMark,
  tabLabel,
  note,
  actions,
  className,
}: WorkbenchChromeProps) {
  return (
    <div className={className}>
      {/* top bar — brand + single active tab */}
      <header className="flex h-14 shrink-0 items-center gap-[14px] border-b px-4">
        <div className="flex items-center gap-[9px]">
          <span
            aria-hidden
            className="bg-primary text-primary-foreground grid size-[26px] place-items-center rounded-md text-xs font-bold"
          >
            {brandMark ?? brand.charAt(0)}
          </span>
          <span className="text-base font-bold tracking-tight">{brand}</span>
        </div>

        <div className="mx-auto">
          <SegmentedControl>
            <SegmentedControlButton active>
              <FolderTree className="size-[15px]" aria-hidden />
              {tabLabel}
            </SegmentedControlButton>
          </SegmentedControl>
        </div>

        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </header>

      {/* explainer strip */}
      <div
        className={cn(
          'bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-2 border-b px-[18px] py-2 text-[13px]'
        )}
      >
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="text-foreground font-semibold">
            {note.label}:
          </strong>{' '}
          {note.text}
        </span>
      </div>
    </div>
  );
}
