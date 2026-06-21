import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import * as React from 'react';

/**
 * DocumentViewerDialog — a MODAL for previewing document-like content at the same
 * READING WIDTH as a full-page reader. The default `DialogContent` is narrow
 * (`max-w-lg`) and padded (`p-6`), which squeezes a reading column; this widens it
 * and drops the padding/gap so the child (e.g. a reading column with its own
 * `max-w`) renders at its natural width — identical to the reader — while staying
 * an obvious, contained preview rather than a full-screen takeover.
 *
 * PLATFORM-flavoured but PRESENTATION-only: title + children are passed in (no
 * i18n/domain). Lives under `components/platform/`.
 */
export function DocumentViewerDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[820px] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-5 py-3 pr-12">
          <DialogTitle className="text-left">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[78vh] w-full overflow-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
