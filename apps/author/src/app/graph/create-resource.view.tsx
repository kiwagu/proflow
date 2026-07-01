'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  isAllowedMediaMime,
  KB_MEDIA_BUCKET,
  type MediaUploadAuthorizeResponse,
} from '@workspace/knowledge-contracts';
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
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';
import { Check, Paperclip, X } from 'lucide-react';
import * as React from 'react';
import { Upload as TusUpload } from 'tus-js-client';

import {
  childFolders,
  rootFolders,
  type Containment,
} from '@/app/graph/containment';
import { formatBytes, iconForKind } from '@/app/graph/presentation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

/**
 * CreateResource — the prototype CreateModal (slice-11 Ф2 §6), a CENTERED
 * modal (shared `Dialog`, not a side sheet). Creates a node of any kind
 * (document/file/video/link/folder/tag) inside an optional parent folder, with an
 * optional description. Each kind routes to its landed RLS write route:
 *   text  → text-resources (node + Lexical body, ADR-0002)
 *   link/tag/folder → resources (body-less; folder is a pure container, ADR-0015)
 *   file/video → body-less node + REAL bytes (ADR-0026, AMENDMENT §A2): create the
 *               node → authorize the upload (server checks node-`update` under RLS +
 *               decides the safe `storagePath`) → RESUMABLE (TUS) upload of the bytes
 *               DIRECTLY to Storage under the caller's JWT → confirm the `media`
 *               satellite. Order matters: the node exists before the path, and the
 *               satellite is written ONLY after the upload succeeds. If ANY
 *               post-create step fails the just-created node is ROLLED BACK
 *               (best-effort purge) so no "broken shell" (a bodyless media node with
 *               no bytes) is left behind — poc-no-fallbacks.
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

export type CreateResourceProps = {
  spaceId: string;
  t: GraphTranslator;
  containment: Containment;
  /** The EFFECTIVE per-org max-upload size in BYTES (ADR-0026 §A3), resolved
   * server-side under the user's RLS and threaded here for the client-side
   * "too large (max {size})" pre-validation hint. A UX hint ONLY — the server
   * authorizer (which re-resolves the same value) + the bucket `file_size_limit`
   * are the real fences. Absent (no active space) → falls back to the 200 MB
   * `DEFAULT_MAX_UPLOAD_BYTES`. */
  maxUploadBytes?: number;
  /** Open request from the container (header New / New folder), or null when shut. */
  request: CreateRequest | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create with the new node id + kind, so the caller
   * can navigate into a new folder / select a new resource (prototype CreateModal). */
  onCreated: (created?: { nodeId: string; kind: CreateKind }) => void;
};

const KINDS: CreateKind[] = ['text', 'file', 'video', 'link', 'folder', 'tag'];

/**
 * The resumable (TUS) chunk size — 6 MiB, the Supabase storage-api-required
 * constant for the `/storage/v1/upload/resumable` endpoint (ADR-0026 AMENDMENT
 * §A2). A CODE constant, NOT env (monorepo-env-minimalism). A sub-chunk (small)
 * file completes in a single PATCH; there is no size-branch on the client.
 */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** The kinds whose content IS a real uploaded file (ADR-0026). */
function kindNeedsMedia(kind: CreateKind): kind is 'file' | 'video' {
  return kind === 'file' || kind === 'video';
}

/** Which client-side pre-validation a picked file fails, or null when it passes.
 * `maxBytes` is the RESOLVED per-org soft limit (ADR-0026 §A3). A UX hint only —
 * the server authorizer + storage RLS + the bucket cap are the real fence. */
function mediaValidationError(
  file: File,
  maxBytes: number
): 'tooLarge' | 'unsupportedType' | null {
  if (file.size > maxBytes) {
    return 'tooLarge';
  }
  if (!isAllowedMediaMime(file.type)) {
    return 'unsupportedType';
  }
  return null;
}

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

export function CreateResource({
  spaceId,
  t,
  containment,
  maxUploadBytes,
  request,
  onOpenChange,
  onCreated,
}: CreateResourceProps) {
  const open = request !== null;
  const [kind, setKind] = React.useState<CreateKind>('text');
  const [title, setTitle] = React.useState('');
  const [parentId, setParentId] = React.useState<string>('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  // The picked media file (file/video kinds) + the client pre-validation verdict.
  const [file, setFile] = React.useState<File | null>(null);
  const [mediaError, setMediaError] = React.useState<
    'tooLarge' | 'unsupportedType' | null
  >(null);
  // The resumable upload progress (0–100), or null when not uploading. Surfaced in
  // the submit button so a large file gives live feedback (ADR-0026 §A2).
  const [uploadPercent, setUploadPercent] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // The EFFECTIVE per-org soft limit (bytes) for the "too large" hint — the
  // server-resolved value, or the 200 MB default when absent (no active space).
  const effectiveMaxBytes = maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  // Reset/prefill when a new open request arrives — adjust state during render on
  // the request transition ("you might not need an effect"), not in an effect.
  if (useValueChanged(request) && request) {
    setKind(request.kind ?? 'text');
    setTitle('');
    setParentId(request.parentFolderId ?? '');
    setDescription('');
    setError(false);
    setFile(null);
    setMediaError(null);
    setUploadPercent(null);
  }

  // Scope the folder picker to the CURRENT level — the folders at the location where
  // creation was triggered (the current folder's direct children, or the top-level
  // folders at root) plus the current container as the default — instead of flattening
  // the WHOLE KB tree into the dropdown (unusable at scale: 1000 folders would all
  // list). To place a resource elsewhere, navigate into that folder first, then create.
  const currentParentId = request?.parentFolderId ?? null;
  const currentFolderNode = currentParentId
    ? (containment.byId.get(currentParentId) ?? null)
    : null;
  const levelFolders = React.useMemo(
    () =>
      currentParentId
        ? childFolders(containment, currentParentId)
        : rootFolders(containment),
    [containment, currentParentId]
  );

  function onPickFile(picked: File | null) {
    setError(false);
    if (!picked) {
      setFile(null);
      setMediaError(null);
      return;
    }
    // Client pre-validation — an instant hint before any network call (the server
    // authorizer + storage RLS remain the real fence).
    setMediaError(mediaValidationError(picked, effectiveMaxBytes));
    setFile(picked);
  }

  const needsMedia = kindNeedsMedia(kind);
  // The media kinds require a valid picked file; other kinds require only a title.
  const submitDisabled =
    busy ||
    title.trim().length === 0 ||
    (needsMedia && (file === null || mediaError !== null));

  async function onSubmit() {
    setBusy(true);
    setError(false);
    try {
      const nodeId = await createNode(spaceId, kind, title.trim(), parentId);
      if (!nodeId) {
        setError(true);
        return;
      }
      // file/video: upload the bytes + confirm the media satellite AFTER the node
      // exists (ADR-0026). The node MUST exist first (the storage path + the
      // `storage.objects` update fence need the nodeId), so we cannot defer its
      // create. To avoid a "broken shell" (a bodyless media node with no bytes) when
      // any post-create step fails, we ROLL BACK: on failure — the upload returning
      // false OR throwing — best-effort PURGE the just-created node before surfacing
      // the error, leaving NO orphan (not even in Trash). Rollback fires ONLY on
      // failure; a success never deletes. text/folder/link/tag are unaffected (an
      // empty draft is valid, not a broken shell).
      if (needsMedia && file) {
        setUploadPercent(0);
        let uploaded = false;
        try {
          uploaded = await uploadMedia(spaceId, nodeId, file, (percent) =>
            setUploadPercent(percent)
          );
        } catch (uploadError) {
          await purgeOrphanNode(spaceId, nodeId);
          throw uploadError;
        }
        if (!uploaded) {
          await purgeOrphanNode(spaceId, nodeId);
          setError(true);
          return;
        }
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
      setUploadPercent(null);
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
                  <Button
                    key={option}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    onClick={() => setKind(option)}
                    aria-pressed={selected}
                    className="gap-1.5"
                  >
                    <Icon className="size-4" aria-hidden />
                    {createKindLabel(t, option)}
                  </Button>
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
                if (event.key === 'Enter' && !submitDisabled) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
              placeholder={t('graph.create.namePlaceholder')}
              disabled={busy}
              autoFocus
            />
          </div>

          {/* FILE — a plain hidden <input type=file> behind a Button, for the media
              kinds (file/video). Client pre-validation (size/mime) surfaces an
              instant hint; the server authorizer + storage RLS are the real fence. */}
          {needsMedia ? (
            <div className="flex flex-col gap-2">
              <Label className={FIELD_LABEL}>{t('graph.media.file')}</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) =>
                  onPickFile(event.target.files?.[0] ?? null)
                }
                disabled={busy}
              />
              {file ? (
                <div className="flex items-center gap-2 rounded-md border p-2.5">
                  <Paperclip
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatBytes(t, file.size)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onPickFile(null)}
                    disabled={busy}
                    aria-label={t('graph.media.clearFile')}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="w-full justify-start gap-2 border-dashed font-normal shadow-none"
                >
                  <Paperclip className="size-4" aria-hidden />
                  {t('graph.media.pickFile')}
                </Button>
              )}
              {mediaError ? (
                <p role="alert" className="text-destructive text-xs">
                  {mediaError === 'tooLarge'
                    ? t('graph.media.tooLarge', {
                        max: formatBytes(t, effectiveMaxBytes),
                      })
                    : t('graph.media.unsupportedType')}
                </p>
              ) : null}
            </div>
          ) : null}

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
                  {currentFolderNode ? (
                    <SelectItem value={currentFolderNode.id}>
                      {currentFolderNode.title}
                    </SelectItem>
                  ) : (
                    <SelectItem value="top">
                      {t('graph.create.topLevel')}
                    </SelectItem>
                  )}
                  {levelFolders.map((folder) => (
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
          <Button onClick={onSubmit} disabled={submitDisabled}>
            <Check className="size-4" aria-hidden />
            {busy
              ? needsMedia
                ? uploadPercent !== null
                  ? t('graph.media.uploadingProgress', {
                      percent: String(uploadPercent),
                    })
                  : t('graph.media.uploading')
                : t('graph.create.saving')
              : t('graph.create.submit')}
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

/**
 * Best-effort ROLL BACK of a just-created media node whose byte-upload failed —
 * purge (hard-delete) it so no "broken shell" (a bodyless file/video node with no
 * satellite) lingers on the canvas OR in Trash. The node was just created and never
 * populated: it carries no living cross-owner references, so the owner's own purge
 * via the existing Trash-lens DELETE (`/author/graph/trash`, DELETE = purge) is
 * clean and direct — no soft-delete-to-Trash detour. REUSES that endpoint's exact
 * wire shape (`{ spaceId, resourceId }`), not a new route.
 *
 * Best-effort by design: a rollback that itself fails must NOT mask or loop over the
 * original upload error — the caller still surfaces that error. We swallow only this
 * delete's own failure (a leftover shell is the pre-existing bug, never a regression).
 */
async function purgeOrphanNode(spaceId: string, nodeId: string): Promise<void> {
  try {
    await fetch('/author/graph/trash', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId, resourceId: nodeId }),
    });
  } catch {
    // Swallow: the original upload error is what the caller surfaces (poc-no-fallbacks).
  }
}

/**
 * Upload a file's BYTES to a node + confirm its media satellite via the RESUMABLE
 * (TUS) transport (ADR-0026 AMENDMENT §A2). Order:
 *   1. authorize (`media?op=upload-url`) — the server checks node-update under RLS,
 *      validates the declared mime/size against the resolved per-org limit, and
 *      returns the SERVER-decided `storagePath` (`spaces/<spaceId>/kb/<nodeId>/<key>`,
 *      the object key within the `kb-media` bucket).
 *   2. RESUMABLE upload of the bytes DIRECTLY to Storage's TUS endpoint
 *      (`/storage/v1/upload/resumable`) under the CALLER's OWN session JWT (§A2
 *      option 2). The `storage.objects` INSERT policy (mirroring node-`update`)
 *      fences the bytes EXACTLY as the single-PUT did — same fence, new transport.
 *      6 MiB chunks; the server NEVER touches the bytes (no Next.js in the data
 *      plane, no public URL). A small file completes in one PATCH (no size-branch).
 *   3. confirm the `media` satellite (`attribute:'media'` on the attributes route)
 *      — written ONLY after a successful upload, so a failed upload leaves NO
 *      satellite row (poc-no-fallbacks). `createdBy` comes from the SESSION.
 * `onProgress` reports 0–100 for the byte-transfer phase. Returns true only when
 * every step succeeds; any failure → false (the caller surfaces the error state).
 */
async function uploadMedia(
  spaceId: string,
  nodeId: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<boolean> {
  const authRes = await fetch('/author/graph/media?op=upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spaceId,
      nodeId,
      mimeType: file.type,
      sizeBytes: file.size,
      filename: file.name,
    }),
  });
  if (!authRes.ok) {
    return false;
  }
  const authorize = (await authRes.json()) as MediaUploadAuthorizeResponse;
  if (!authorize.storagePath) {
    return false;
  }

  // The bytes travel under the CALLER's own session JWT (never service-role) — the
  // same identity `storage.objects` INSERT RLS fences on. Bail if there is no
  // session / no configured Storage endpoint (fail-closed, poc-no-fallbacks).
  const supabase = getSupabaseBrowserClient();
  const storageBaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabase || !storageBaseUrl) {
    return false;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return false;
  }

  const uploaded = await uploadBytesResumable({
    file,
    accessToken,
    endpoint: `${storageBaseUrl}/storage/v1/upload/resumable`,
    objectName: authorize.storagePath,
    onProgress,
  });
  if (!uploaded) {
    return false;
  }

  const confirmRes = await fetch('/author/graph/attributes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attribute: 'media',
      spaceId,
      nodeId,
      storagePath: authorize.storagePath,
      mimeType: file.type,
      sizeBytes: file.size,
      originalFilename: file.name,
    }),
  });
  return confirmRes.ok;
}

/**
 * Drive ONE resumable (TUS) upload of `file` to Storage's TUS endpoint and resolve
 * `true` on success / `false` on any error (ADR-0026 §A2). Bytes go DIRECT to
 * Storage under the caller's session JWT — never through Next.js, never a public URL.
 * 6 MiB chunks (`TUS_CHUNK_SIZE`, the Supabase-required constant). `objectName` is
 * the server-decided path within `KB_MEDIA_BUCKET`; the storage-RLS INSERT policy is
 * the enforcing fence at PATCH time.
 */
function uploadBytesResumable({
  file,
  accessToken,
  endpoint,
  objectName,
  onProgress,
}: {
  file: File;
  accessToken: string;
  endpoint: string;
  objectName: string;
  onProgress: (percent: number) => void;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const upload = new TusUpload(file, {
      endpoint,
      chunkSize: TUS_CHUNK_SIZE,
      // TUS session under the caller's JWT — the storage identity storage.objects
      // RLS fences on (never service-role). `x-upsert:false` keeps the create honest
      // (the server-decided path is unique per upload).
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-upsert': 'false',
      },
      // Supabase storage-api requires the object metadata on the TUS session — the
      // target bucket + the server-decided object key + the content type.
      metadata: {
        bucketName: KB_MEDIA_BUCKET,
        objectName,
        contentType: file.type || 'application/octet-stream',
      },
      // storage-api validates the declared size against the resumable ceiling.
      uploadDataDuringCreation: true,
      // Do not persist resume fingerprints — each create authorizes a fresh path.
      removeFingerprintOnSuccess: true,
      onProgress: (bytesSent, bytesTotal) => {
        const percent =
          bytesTotal > 0
            ? Math.min(100, Math.round((bytesSent / bytesTotal) * 100))
            : 0;
        onProgress(percent);
      },
      onSuccess: () => resolve(true),
      onError: () => resolve(false),
    });
    upload.start();
  });
}
