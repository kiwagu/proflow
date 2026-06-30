import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
import { Hint } from '@workspace/ui/components/hint';
import { DocumentViewerDialog } from '@workspace/ui/components/platform/document-viewer-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select';
import {
  ArrowRight,
  Check,
  Eye,
  FilePlus,
  GitCompare,
  History,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import {
  DocumentBodyView,
  type SerializedLexical,
} from '@/app/graph/views/document-reader/document-body-view';
import { RevisionDiff } from '@/app/graph/views/document-reader/revision-diff';

import { PanelSectionLabel } from './panel-section-label';
import { sendJson } from './panel-fetch';

type VersionEntry = { id: string; status: string | null; updatedAt: string };

/**
 * VersionPicker — one side of the revision-diff header: a compact <select> over
 * the version list, each option labelled "status · time" (mirrors the row).
 */
function VersionPicker({
  value,
  onChange,
  versions,
  ariaLabel,
  t,
}: {
  value: string | null;
  onChange: (id: string) => void;
  versions: VersionEntry[] | null;
  ariaLabel: string;
  t: ReturnType<typeof createGraphTranslator>;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="w-auto max-w-[45%] gap-1.5 text-xs"
        aria-label={ariaLabel}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(versions ?? []).map((v) => (
          <SelectItem key={v.id} value={v.id} className="text-xs">
            {`${
              v.status === 'published'
                ? t('graph.reader.statusPublished')
                : t('graph.reader.statusDraft')
            } · ${new Date(v.updatedAt).toLocaleString()}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Versions — the tangible draft/publish history for a `kind=text` node's body
 * (Payload records a version on every save). Read-only list, fetched on demand
 * when the panel opens. Shows each version's draft/published status + time so the
 * moderator sees the workflow concretely. Reads are RLS-gated server-side.
 */
export function VersionsSection({
  t,
  spaceId,
  nodeId,
  onMutated,
}: {
  t: ReturnType<typeof createGraphTranslator>;
  spaceId: string;
  nodeId: string;
  onMutated: () => void;
}) {
  const [versions, setVersions] = React.useState<VersionEntry[] | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [viewBody, setViewBody] = React.useState<SerializedLexical | null>(
    null
  );
  const [viewing, setViewing] = React.useState<VersionEntry | null>(null);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null
  );
  const [deleting, setDeleting] = React.useState(false);
  const [diffOpen, setDiffOpen] = React.useState(false);
  const [diffBeforeId, setDiffBeforeId] = React.useState<string | null>(null);
  const [diffAfterId, setDiffAfterId] = React.useState<string | null>(null);
  const [diffBefore, setDiffBefore] = React.useState<SerializedLexical | null>(
    null
  );
  const [diffAfter, setDiffAfter] = React.useState<SerializedLexical | null>(
    null
  );

  const base = `node_id=${encodeURIComponent(nodeId)}&space_id=${encodeURIComponent(spaceId)}`;

  const fetchVersionBody = React.useCallback(
    async (id: string): Promise<SerializedLexical | null> => {
      const res = await fetch(
        `/author/graph/text-resources/versions?${base}&version_id=${encodeURIComponent(id)}`
      );
      return res.ok
        ? (((await res.json()) as { body: SerializedLexical | null }).body ??
            null)
        : null;
    },
    [base]
  );

  const load = React.useCallback(async () => {
    const res = await fetch(`/author/graph/text-resources/versions?${base}`);
    setVersions(
      res.ok
        ? ((await res.json()) as { versions: VersionEntry[] }).versions
        : []
    );
  }, [base]);

  // Genuine load effect: fetch the version list on mount and whenever the query
  // changes. The reset-to-loading on node switch is handled by a `key` remount at
  // the call site (initial `versions` is already `null`), so no synchronous
  // setState is needed here.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async setState (post-fetch) inside an owned data-load effect
    void load();
  }, [load]);

  async function viewVersion(entry: VersionEntry) {
    setViewBody(await fetchVersionBody(entry.id));
    setViewing(entry);
    setViewOpen(true);
  }

  // Open the diff modal comparing any two versions. The Compare action seeds it
  // with previous → current (the common case); inside, each side is freely
  // reselectable (any-to-any).
  async function openDiff(beforeId: string, afterId: string) {
    const [olderBody, newerBody] = await Promise.all([
      fetchVersionBody(beforeId),
      fetchVersionBody(afterId),
    ]);
    setDiffBeforeId(beforeId);
    setDiffAfterId(afterId);
    setDiffBefore(olderBody);
    setDiffAfter(newerBody);
    setDiffOpen(true);
  }

  // Re-pick one side of the diff — fetch just that version's body.
  async function selectDiffSide(side: 'before' | 'after', id: string) {
    const body = await fetchVersionBody(id);
    if (side === 'before') {
      setDiffBeforeId(id);
      setDiffBefore(body);
    } else {
      setDiffAfterId(id);
      setDiffAfter(body);
    }
  }

  // Edit from THIS version: open the editor seeded with it (`?version=<id>`). The
  // draft is recorded when the editor saves — no premature, confusing version row.
  // For a published version this starts a NEW draft from it; for a draft it
  // continues that draft.
  function editFromVersion() {
    if (!viewing) {
      return;
    }
    window.location.assign(
      `${AUTHOR_BASE_PATH}/doc/${encodeURIComponent(nodeId)}?version=${encodeURIComponent(viewing.id)}`
    );
  }

  // "Create draft from this version" (works for a draft OR a published version):
  // record a NEW draft from this body, then land in the editor on it — so the draft
  // is created AND immediately editable (not just a new row in the list).
  async function createDraftFromVersion() {
    setWorking(true);
    const ok = await sendJson(
      '/author/graph/text-resources',
      { spaceId, nodeId, body: viewBody, status: 'draft' },
      'PATCH'
    );
    setWorking(false);
    if (ok) {
      // The new draft is now the latest → the editor's default seed opens it.
      window.location.assign(
        `${AUTHOR_BASE_PATH}/doc/${encodeURIComponent(nodeId)}`
      );
    }
  }

  // Publish this DRAFT — act ON the draft, not via a forked copy. Payload's update
  // always records a new version, so publishing then drops the SOURCE draft: the
  // content ends up as a single PUBLISHED version with no leftover duplicate draft.
  // (After publishing, the new published version is `latest`, so the source draft
  // is non-latest and safe to delete.)
  async function publishVersion() {
    if (!viewing) {
      return;
    }
    setWorking(true);
    const sourceDraftId = viewing.id;
    const ok = await sendJson(
      '/author/graph/text-resources',
      { spaceId, nodeId, body: viewBody, status: 'published' },
      'PATCH'
    );
    if (ok) {
      await sendJson(
        '/author/graph/text-resources/versions',
        { spaceId, nodeId, versionId: sourceDraftId },
        'DELETE'
      );
    }
    setWorking(false);
    if (ok) {
      setViewOpen(false);
      await load();
      onMutated();
    }
  }

  // Delete a single DRAFT version from history (the backend rejects published ones).
  async function deleteVersion() {
    if (!confirmDeleteId) {
      return;
    }
    setDeleting(true);
    const ok = await sendJson(
      '/author/graph/text-resources/versions',
      { spaceId, nodeId, versionId: confirmDeleteId },
      'DELETE'
    );
    setDeleting(false);
    if (ok) {
      if (viewing?.id === confirmDeleteId) {
        setViewOpen(false);
      }
      setConfirmDeleteId(null);
      await load();
      onMutated();
    }
  }

  async function restore() {
    if (!confirmId) {
      return;
    }
    setRestoring(true);
    try {
      const res = await fetch('/author/graph/text-resources/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          nodeId,
          versionId: confirmId,
          action: 'restore',
        }),
      });
      if (res.ok) {
        setConfirmId(null);
        await load();
      }
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <PanelSectionLabel>
        <History className="size-3" aria-hidden />
        {t('graph.panel.versions')}
      </PanelSectionLabel>
      {versions === null ? null : versions.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t('graph.panel.versionsEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v, idx) => (
            <li key={v.id} className="flex items-center gap-2 text-xs">
              <Badge
                variant={v.status === 'published' ? 'secondary' : 'outline'}
              >
                {v.status === 'published'
                  ? t('graph.reader.statusPublished')
                  : t('graph.reader.statusDraft')}
              </Badge>
              <span className="text-muted-foreground flex-1 truncate">
                {new Date(v.updatedAt).toLocaleString()}
              </span>
              <Hint label={t('graph.panel.versionView')}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void viewVersion(v)}
                  aria-label={t('graph.panel.versionView')}
                >
                  <Eye className="size-3.5" aria-hidden />
                </Button>
              </Hint>
              {/* Compare — seeds the diff with previous → this version; both
                  sides are then freely reselectable (any-to-any). Placeholder on
                  the oldest row keeps the column aligned. */}
              {idx < versions.length - 1 ? (
                <Hint label={t('graph.panel.versionCompare')}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      const previous = versions[idx + 1];
                      if (previous) {
                        void openDiff(previous.id, v.id);
                      }
                    }}
                    aria-label={t('graph.panel.versionCompare')}
                  >
                    <GitCompare className="size-3.5" aria-hidden />
                  </Button>
                </Hint>
              ) : (
                <span className="size-8 shrink-0" aria-hidden />
              )}
              <Hint label={t('graph.panel.versionRestore')}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setConfirmId(v.id)}
                  aria-label={t('graph.panel.versionRestore')}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                </Button>
              </Hint>
              {/* Delete — only DRAFT versions (published history is immutable).
                  A fixed-width placeholder keeps the column aligned on published
                  rows, so each column holds ONE action across the whole list. */}
              {v.status !== 'published' ? (
                <Hint label={t('graph.panel.versionDelete')}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteId(v.id)}
                    aria-label={t('graph.panel.versionDelete')}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </Hint>
              ) : (
                <span className="size-8 shrink-0" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmId(null);
          }
        }}
        title={t('graph.panel.versionRestoreConfirm')}
        confirmLabel={t('graph.panel.versionRestore')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={() => void restore()}
        busy={restoring}
        confirmIcon={<RotateCcw className="size-4" aria-hidden />}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteId(null);
          }
        }}
        title={t('graph.panel.versionDeleteConfirm')}
        confirmLabel={t('graph.panel.versionDelete')}
        cancelLabel={t('graph.panel.cancel')}
        onConfirm={() => void deleteVersion()}
        busy={deleting}
        destructive
        confirmIcon={<Trash2 className="size-4" aria-hidden />}
      />

      {/* Version preview — a CONTAINED modal (clearly a preview), at the SAME
          reading width as the reader (the viewer dialog widens + un-pads so the
          shared `DocumentBodyView` column renders identically). */}
      <DocumentViewerDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        title={t('graph.panel.versionViewTitle')}
        footer={
          <>
            {/* Delete — only DRAFT versions; pushed to the left of the actions. */}
            {viewing && viewing.status !== 'published' ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive mr-auto"
                disabled={working}
                onClick={() => setConfirmDeleteId(viewing.id)}
              >
                <Trash2 className="size-4" aria-hidden />
                {t('graph.panel.versionDelete')}
              </Button>
            ) : null}
            {/* Publish makes a DRAFT version the latest published version. */}
            {viewing?.status !== 'published' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={working}
                onClick={() => void publishVersion()}
              >
                <Check className="size-4" aria-hidden />
                {t('graph.reader.publish')}
              </Button>
            ) : null}
            {/* Create draft from this version — fork a NEW draft (from a draft OR a
                published version) and open it in the editor straight away. */}
            <Button
              size="sm"
              variant={viewing?.status === 'published' ? 'default' : 'outline'}
              disabled={working}
              onClick={() => void createDraftFromVersion()}
            >
              <FilePlus className="size-4" aria-hidden />
              {t('graph.panel.versionCreateDraft')}
            </Button>
            {/* Continue editing — resume THIS draft directly (no extra copy). */}
            {viewing?.status !== 'published' ? (
              <Button size="sm" disabled={working} onClick={editFromVersion}>
                <Pencil className="size-4" aria-hidden />
                {t('graph.panel.versionContinueEditing')}
              </Button>
            ) : null}
          </>
        }
      >
        <DocumentBodyView
          body={viewBody}
          emptyLabel={t('graph.reader.empty')}
        />
      </DocumentViewerDialog>

      {/* Revision diff — a word-level text diff between ANY two versions, at the
          same reading width as the preview. The pinned header picks each side:
          left = base (older), right = compared-to (newer). */}
      <DocumentViewerDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        title={t('graph.panel.versionDiffTitle')}
      >
        <div className="bg-background sticky top-0 z-10 flex items-center justify-center gap-2 border-b px-6 py-2.5">
          <VersionPicker
            value={diffBeforeId}
            onChange={(id) => void selectDiffSide('before', id)}
            versions={versions}
            ariaLabel={t('graph.panel.versionDiffBase')}
            t={t}
          />
          <ArrowRight
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden
          />
          <VersionPicker
            value={diffAfterId}
            onChange={(id) => void selectDiffSide('after', id)}
            versions={versions}
            ariaLabel={t('graph.panel.versionDiffCompared')}
            t={t}
          />
        </div>
        <RevisionDiff
          before={diffBefore}
          after={diffAfter}
          emptyLabel={t('graph.panel.versionDiffEmpty')}
        />
      </DocumentViewerDialog>
    </section>
  );
}
