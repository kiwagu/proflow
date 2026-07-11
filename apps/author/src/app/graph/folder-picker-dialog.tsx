'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog';
import { Label } from '@workspace/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import * as React from 'react';

/**
 * FolderPickerDialog — the shared "pick a destination folder" modal (a `contains`
 * re-parent target). ONE picker for the single-node ⋯ Move AND the B2 bulk Move-to-
 * folder, so the folder-choice UX can never drift between them (reuse-first). The
 * folder list is domain data the caller resolves under RLS; the dialog is pure
 * mechanism — CONTROLLED `value` (`'top'` = top level, else a folder id) + `onSubmit`.
 * All copy is passed / i18n-driven here.
 */
export function FolderPickerDialog({
  t,
  open,
  onOpenChange,
  folders,
  title,
  submitLabel,
  value,
  onValueChange,
  onSubmit,
  busy = false,
}: {
  t: GraphTranslator;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selectable destination folders (already RLS-resolved by the caller). */
  folders: { id: string; title: string }[];
  title: string;
  submitLabel: string;
  /** The chosen target — `'top'` (top level) or a folder id. Controlled by the caller. */
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="folder-picker-target">
            {t('graph.create.parentFolder')}
          </Label>
          <Select value={value} onValueChange={onValueChange}>
            <SelectTrigger id="folder-picker-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">{t('graph.create.topLevel')}</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {t('graph.panel.cancel')}
            </Button>
          </DialogClose>
          <Button onClick={onSubmit} disabled={busy}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
