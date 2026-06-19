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
import { Input } from '@workspace/ui/components/input';
import { Label } from '@workspace/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import { Textarea } from '@workspace/ui/components/textarea';
import { cn } from '@workspace/ui/lib/utils';
import { Check } from 'lucide-react';
import * as React from 'react';

import { allFolders, type Containment } from './lens-containment';
import { iconForKind } from './lens-presentation';

/**
 * LensCreateResource — the prototype CreateModal (slice-11 Ф2 §6), a CENTERED
 * modal (shared `Dialog`, not a side sheet). Creates a node of any kind
 * (document/file/video/link/folder/tag) inside an optional parent folder, with an
 * optional description. Each kind routes to its landed RLS write route:
 *   text  → text-resources (node + Lexical body, ADR-0002)
 *   link/tag/folder → resources (body-less; folder is a pure container, ADR-0015)
 *   file/video → body-less node + media-meta (real binary upload is a deferred
 *               slice, poc-no-fallbacks — metadata only)
 * Containment placement (`parentFolder`) creates a FORWARD `contains` edge; the
 * description is posted to the attributes route AFTER the node is created.
 *
 * THIN form POSTing to landed RLS routes — no write logic here, RLS the sole
 * authority (a reader's create fails cleanly). After success the container
 * refetches (router.refresh).
 */

type CreateKind = 'text' | 'file' | 'video' | 'link' | 'folder' | 'tag';

export type CreateRequest = {
  /** Prefill the kind (e.g. "New folder" header button). */
  kind?: CreateKind;
  /** Prefill the parent folder (the browse folder). */
  parentFolderId?: string | null;
};

export type LensCreateResourceProps = {
  spaceId: string;
  t: GraphTranslator;
  containment: Containment;
  /** Open request from the container (header New / New folder), or null when shut. */
  request: CreateRequest | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create with the new node id + kind, so the caller
   * can navigate into a new folder / select a new resource (prototype CreateModal). */
  onCreated: (created?: { nodeId: string; kind: CreateKind }) => void;
};

const KINDS: CreateKind[] = ['text', 'file', 'video', 'link', 'folder', 'tag'];

/** Create-kind label via LITERAL keys (no dynamic-key indirection in views). */
function createKindLabel(t: GraphTranslator, kind: CreateKind): string {
  switch (kind) {
    case 'text':
      return t('graph.create.kindText');
    case 'file':
      return t('graph.create.kindFile');
    case 'video':
      return t('graph.create.kindVideo');
    case 'link':
      return t('graph.create.kindLink');
    case 'folder':
      return t('graph.create.kindFolder');
    case 'tag':
      return t('graph.create.kindTag');
  }
}

const FIELD_LABEL =
  'text-foreground text-xs font-semibold tracking-wide uppercase';

export function LensCreateResource({
  spaceId,
  t,
  containment,
  request,
  onOpenChange,
  onCreated,
}: LensCreateResourceProps) {
  const open = request !== null;
  const [kind, setKind] = React.useState<CreateKind>('text');
  const [title, setTitle] = React.useState('');
  const [parentId, setParentId] = React.useState<string>('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);

  // Reset/prefill when a new open request arrives.
  React.useEffect(() => {
    if (request) {
      setKind(request.kind ?? 'text');
      setTitle('');
      setParentId(request.parentFolderId ?? '');
      setDescription('');
      setError(false);
    }
  }, [request]);

  const folders = React.useMemo(() => allFolders(containment), [containment]);

  async function onSubmit() {
    setBusy(true);
    setError(false);
    try {
      const nodeId = await createNode(spaceId, kind, title.trim(), parentId);
      if (!nodeId) {
        setError(true);
        return;
      }
      // description rides on the attributes route after the node exists (the
      // RAG-bound field, stored — vector seam hidden, poc-no-fallbacks).
      if (kind !== 'tag' && description.trim().length > 0) {
        await fetch('/author/graph/attributes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attribute: 'description',
            spaceId,
            nodeId,
            body: description.trim(),
          }),
        });
      }
      onOpenChange(false);
      onCreated({ nodeId, kind });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('graph.create.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* TYPE — segmented icon buttons (prototype CreateModal) */}
          <div className="flex flex-col gap-2">
            <Label className={FIELD_LABEL}>{t('graph.create.kind')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((option) => {
                const Icon = iconForKind(option);
                const selected = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setKind(option)}
                    aria-pressed={selected}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                      selected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {createKindLabel(t, option)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TITLE */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="create-title" className={FIELD_LABEL}>
              {t('graph.create.name')}
            </Label>
            <Input
              id="create-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && title.trim().length > 0 && !busy) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
              placeholder={t('graph.create.namePlaceholder')}
              disabled={busy}
              autoFocus
            />
          </div>

          {/* FOLDER */}
          {kind !== 'tag' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-parent" className={FIELD_LABEL}>
                {kind === 'folder'
                  ? t('graph.create.parentFolder')
                  : t('graph.create.folder')}
              </Label>
              <Select
                value={parentId || 'top'}
                onValueChange={(value) =>
                  setParentId(value === 'top' ? '' : value)
                }
              >
                <SelectTrigger id="create-parent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">
                    {t('graph.create.topLevel')}
                  </SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* DESCRIPTION */}
          {kind !== 'tag' ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="create-description" className={FIELD_LABEL}>
                {t('graph.create.description')}{' '}
                <span className="text-muted-foreground font-normal normal-case">
                  · {t('graph.create.descriptionHint')}
                </span>
              </Label>
              <Textarea
                id="create-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t('graph.create.descriptionPlaceholder')}
                rows={3}
                disabled={busy}
              />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {t('graph.create.error')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {t('graph.create.cancel')}
            </Button>
          </DialogClose>
          <Button
            onClick={onSubmit}
            disabled={busy || title.trim().length === 0}
          >
            <Check className="size-4" aria-hidden />
            {busy ? t('graph.create.saving') : t('graph.create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The minimal empty Lexical root the `bodies` richText field accepts. */
const EMPTY_LEXICAL = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr',
    children: [
      {
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [],
      },
    ],
  },
} as const;

/** Create a node of `kind`, returning its node id, or null on failure. */
async function createNode(
  spaceId: string,
  kind: CreateKind,
  title: string,
  parentId: string
): Promise<string | null> {
  const parentFolder = parentId ? { parentFolderId: parentId } : undefined;

  if (kind === 'text') {
    const res = await fetch('/author/graph/text-resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spaceId,
        title,
        lexicalBody: EMPTY_LEXICAL,
        parentFolder,
      }),
    });
    if (!res.ok) {
      return null;
    }
    return ((await res.json()) as { node_id: string }).node_id;
  }

  // link/tag/folder/file/video are body-less node inserts (ADR-0002 §3 /
  // ADR-0015). file/video create a REAL node now; the binary asset + Storage
  // upload is a deferred media slice (poc-no-fallbacks — no fake asset).
  const res = await fetch('/author/graph/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      kind,
      title,
      ...(kind === 'tag' ? {} : { parentFolder }),
    }),
  });
  if (!res.ok) {
    return null;
  }
  return ((await res.json()) as { node_id: string }).node_id;
}
