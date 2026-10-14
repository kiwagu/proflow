'use client';

import type { DocumentVersion } from '@workspace/domain';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { EmptyState } from '@workspace/ui/components/empty-state';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { cn } from '@workspace/ui/lib/utils';
import type { ReactNode } from 'react';
import { newestFirst, versionAge } from './history.js';
import { defaultHistoryLabels, type HistoryLabels } from './labels.js';

export type HistoryPanelProps = {
  /** Every marked version of the open document, in any order. */
  versions: DocumentVersion[];
  /** Which version is being previewed, by id. */
  selectedId?: string | null;
  /**
   * The previewed document, rendered by the host — a read-only editor over
   * the tree it read at that version, or a note that the version cannot be
   * shown. The panel owns WHEN a preview is on screen; the host owns what it
   * looks like, the same way the outline owns navigation but not the editor.
   */
  preview?: ReactNode;
  /**
   * A version was chosen. The whole version is handed back rather than only
   * its `ref`: the ref is opaque by contract, so the host needs the row's
   * identity as well to say which one it is showing.
   */
  onPreview: (version: DocumentVersion) => void;
  /** The previewed version should become the document's current state. */
  /** Absent when the person may not write the document: no restore is offered. */
  onRestore?: (version: DocumentVersion) => void;
  labels?: HistoryLabels;
  /** The moment ages are measured against. A seam for specs. */
  now?: Date;
  className?: string;
};

/**
 * A document's history: every marked version, newest first, with a read-only
 * preview of the one selected and a way to bring it back.
 *
 * Data-only, like the outline beside it: the panel is handed the versions and
 * two callbacks, and knows nothing about the store they came from — so it
 * renders the same in the app and in a spec, and the app stays the one place
 * that talks to a port.
 */
export function HistoryPanel({
  versions,
  selectedId,
  preview,
  onPreview,
  onRestore,
  labels = defaultHistoryLabels,
  now,
  className,
}: HistoryPanelProps) {
  const ordered = newestFirst(versions);
  const selected = ordered.find((version) => version.id === selectedId);
  const measuredAt = now ?? new Date();

  return (
    <section
      aria-label={labels.ariaLabel}
      data-testid="history-panel"
      className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}
    >
      <h2 className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
        {labels.title}
      </h2>

      {ordered.length === 0 ? (
        <EmptyState data-testid="history-empty">{labels.empty}</EmptyState>
      ) : (
        <ScrollArea className="max-h-64 shrink-0">
          <ul className="flex flex-col gap-0.5 pr-2" data-testid="history-list">
            {ordered.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  data-testid="history-version"
                  aria-current={version.id === selectedId ? 'true' : undefined}
                  onClick={() => onPreview(version)}
                  className={cn(
                    'hover:bg-accent hover:text-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                    version.id === selectedId &&
                      'bg-accent text-foreground font-semibold'
                  )}
                >
                  <span className="shrink-0">
                    {labels.age(versionAge(version.createdAt, measuredAt))}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {labels.kind[version.kind]}
                  </Badge>
                  {version.label ? (
                    <span className="truncate">{version.label}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}

      {selected ? (
        <div
          className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-2"
          data-testid="history-preview"
        >
          {onRestore ? (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              data-testid="history-restore"
              onClick={() => onRestore(selected)}
            >
              {labels.restore}
            </Button>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">{preview}</div>
        </div>
      ) : null}
    </section>
  );
}
