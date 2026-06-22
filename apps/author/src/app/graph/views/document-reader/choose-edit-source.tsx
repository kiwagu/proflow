'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { cn } from '@workspace/ui/lib/utils';
import { BookCheck, FilePen } from 'lucide-react';
import * as React from 'react';

export type DraftVersion = { id: string; updatedAt: string };

/** `'published'` → a new draft from the published version; else a version id. */
export type EditSource = 'published' | string;

/**
 * ChooseEditSourceDialog — a single-select (radio) chooser shown when a PUBLISHED
 * document also carries unpublished draft(s). Read mode shows only the published
 * version, so "Edit" must not silently open the latest draft; instead the user
 * deliberately picks: start a NEW draft from the published version, or continue
 * one of the existing drafts (which becomes the latest once saved).
 */
export function ChooseEditSourceDialog({
  open,
  onOpenChange,
  t,
  drafts,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: GraphTranslator;
  drafts: DraftVersion[];
  onConfirm: (source: EditSource) => void;
}) {
  const [selected, setSelected] = React.useState<EditSource>('published');
  // Default back to "from published" each time the chooser opens.
  React.useEffect(() => {
    if (open) {
      setSelected('published');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('graph.reader.editChooseTitle')}</DialogTitle>
          <DialogDescription>
            {t('graph.reader.editChooseDescription')}
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label={t('graph.reader.editChooseTitle')}
          className="flex flex-col gap-2"
        >
          <SourceOption
            selected={selected === 'published'}
            onSelect={() => setSelected('published')}
            icon={<BookCheck className="size-4" aria-hidden />}
            title={t('graph.reader.editFromPublished')}
          />
          {drafts.map((d) => (
            <SourceOption
              key={d.id}
              selected={selected === d.id}
              onSelect={() => setSelected(d.id)}
              icon={<FilePen className="size-4" aria-hidden />}
              title={t('graph.reader.editContinueDraft')}
              subtitle={new Date(d.updatedAt).toLocaleString()}
            />
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('graph.reader.cancel')}
          </Button>
          <Button onClick={() => onConfirm(selected)}>
            {t('graph.reader.edit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceOption({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ring ring-ring/35 ring-[3px]' : 'hover:bg-accent'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          selected ? 'border-primary' : 'border-muted-foreground/50'
        )}
      >
        {selected ? <span className="bg-primary size-2 rounded-full" /> : null}
      </span>
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="text-muted-foreground block truncate text-xs">
            {subtitle}
          </span>
        ) : null}
      </span>
    </button>
  );
}
