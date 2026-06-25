'use client';

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
import { Textarea } from '@workspace/ui/components/textarea';
import {
  ArrowRight,
  Check,
  Eye,
  FilePlus,
  GitCompare,
  History,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';
import { type Containment } from '@/app/graph/containment';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';
import {
  DocumentBodyView,
  type SerializedLexical,
} from '@/app/graph/views/document-reader/document-body-view';
import { RevisionDiff } from '@/app/graph/views/document-reader/revision-diff';
import type {
  KbAttributes,
  ResourceFloor,
  ScopeChoice,
  SpaceCapabilities,
} from '@/app/graph/graph-data.types';
import { iconForKind, kindLabel } from '@/app/graph/presentation';

/**
 * ResourcePanel — the node DETAIL panel ("Details"): single-click a node (or pick
 * Details from its `⋯` menu) → an INLINE right-side panel (the prototype's `aside`,
 * not a modal): a fixed-width column that lives in the workbench flex row and
 * shrinks the content beside it (no overlay, the grid stays interactive), closed by
 * the header `✕`. It carries the rich, edit-heavy surface.
 * Quick manipulations (new subfolder / rename / move / delete) do NOT live here —
 * they are one click from the card / toolbar via the shared {@link NodeActionsMenu},
 * which the header re-uses (sans its Details item) so the same actions are reachable
 * from inside the drawer too. Landed sections:
 *   - header (kind + title) + the `⋯` action menu
 *   - editable, RAG-bound description (kb satellite)
 *   - visibility (cohort scopes)
 *
 * Deferred (their backend is not ported yet, so the section is omitted rather than
 * mocked — Law 3 / poc-no-fallbacks): tags / related / mini-graph (need the
 * neighborhood resolver), media (kb satellites), status transition, suggested links
 * (a RAG mock), view-in-graph (the graph view). They return with their backend.
 *
 * Purely presentational: it POSTs to the landed RLS routes; RLS is the authority.
 */

export type SelectedNode = {
  id: string;
  title: string;
  kind: string;
  status?: string;
};

export type ResourcePanelProps = {
  spaceId: string;
  messages: Record<string, string>;
  node: SelectedNode | null;
  /** KB satellite attributes of the node (description; media/link as they land). */
  attributes?: KbAttributes;
  containment: Containment;
  /** The viewer's own id — combined with `ownerUserId` to display-gate the `⋯` menu. */
  currentUserId: string | null;
  /** The selected node's owner (`knowledge_resources.owner_user_id`). */
  ownerUserId: string | null;
  /** The viewer's space-level knowledge verbs — display-gate the `⋯` menu (ADR-0006). */
  capabilities: SpaceCapabilities;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-run the server resolve after a mutation (the workbench refreshes). */
  onMutated: () => void;
  /** Edit a text node directly (the workbench's edit launcher). */
  onEdit?: (nodeId: string) => void;
};

async function sendJson(
  path: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST'
): Promise<boolean> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function ResourcePanel({
  spaceId,
  messages,
  node,
  attributes,
  containment,
  currentUserId,
  ownerUserId,
  capabilities,
  open,
  onOpenChange,
  onMutated,
  onEdit,
}: ResourcePanelProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);
  const [busy, setBusy] = React.useState(false);

  if (!node || !open) {
    return null;
  }
  const KindIcon = iconForKind(node.kind);

  // Description save refreshes WITHOUT closing — the panel stays open with the
  // updated text (the user may keep editing).
  async function onSaveDescription(body: string) {
    setBusy(true);
    const ok = await sendJson('/author/graph/attributes', {
      attribute: 'description',
      spaceId,
      nodeId: node!.id,
      body,
    });
    setBusy(false);
    if (ok) {
      onMutated();
    }
  }

  return (
    <aside
      aria-label={node.title}
      className="bg-card motion-safe:animate-in motion-safe:slide-in-from-right-4 flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-l motion-safe:duration-200"
    >
      {/* header — icon + kind + actions + close. Same vertical rhythm as the main
          toolbar (`py-3` over 32px-tall controls) so the panel's bottom border
          lines up with the content toolbar's across the split. */}
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <span
          aria-hidden
          className="bg-muted grid size-8 shrink-0 place-items-center rounded-md"
        >
          <KindIcon className="text-muted-foreground size-[17px]" />
        </span>
        <span className="text-muted-foreground flex-1 text-xs tracking-wide uppercase">
          {kindLabel(t, node.kind)}
        </span>
        {/* Same action menu as the cards — panel = "Details", so no Details item. */}
        <NodeActionsMenu
          spaceId={spaceId}
          t={t}
          node={node}
          containment={containment}
          currentUserId={currentUserId}
          ownerUserId={ownerUserId}
          capabilities={capabilities}
          onMutated={onMutated}
          onActed={() => onOpenChange(false)}
          onEdit={
            node.kind === 'text' && onEdit ? () => onEdit(node.id) : undefined
          }
        />
        <Hint label={t('graph.panel.close')}>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label={t('graph.panel.close')}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </Hint>
      </div>

      <div className="flex flex-col gap-5 px-4 py-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold tracking-tight">{node.title}</h2>
          {node.status ? (
            <div>
              <Badge variant="outline">{node.status}</Badge>
            </div>
          ) : null}
        </div>

        <EditableDescription
          t={t}
          value={attributes?.description ?? ''}
          nodeId={node.id}
          disabled={busy}
          onSave={onSaveDescription}
        />
        <VisibilitySection
          t={t}
          spaceId={spaceId}
          nodeId={node.id}
          disabled={busy}
          onMutated={onMutated}
        />
        {node.kind === 'text' ? (
          <VersionsSection
            t={t}
            spaceId={spaceId}
            nodeId={node.id}
            onMutated={onMutated}
          />
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Editable, RAG-bound description (stored). Saved on Save / ⌘↵. The vector index
 * status/reindex is NOT shown — RAG seam, no pipeline (poc-no-fallbacks; the
 * prototype's mocked embed badge is intentionally dropped).
 */
function EditableDescription({
  t,
  value,
  nodeId,
  disabled,
  onSave,
}: {
  t: ReturnType<typeof createGraphTranslator>;
  value: string;
  nodeId: string;
  disabled: boolean;
  onSave: (body: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
    setEditing(false);
  }, [value, nodeId]);

  return (
    <section className="flex flex-col gap-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] uppercase">
        <Sparkles className="size-3" aria-hidden />
        {t('graph.panel.description')}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(value);
                setEditing(false);
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                onSave(draft.trim());
                setEditing(false);
              }
            }}
            rows={4}
            placeholder={t('graph.panel.descriptionPlaceholder')}
            disabled={disabled}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                onSave(draft.trim());
                setEditing(false);
              }}
              disabled={disabled}
            >
              <Check className="size-4" aria-hidden />
              {t('graph.panel.save')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
              disabled={disabled}
            >
              {t('graph.panel.cancel')}
            </Button>
            <span className="text-muted-foreground ml-auto text-xs">
              {t('graph.panel.descriptionHint')}
            </span>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setEditing(true)}
          className="hover:border-ring hover:bg-accent h-auto w-full items-start justify-start gap-2 border-dashed p-2.5 text-left font-normal shadow-none"
        >
          <span className="text-muted-foreground flex-1 whitespace-normal">
            {value || t('graph.panel.descriptionEmpty')}
          </span>
          <Pencil
            className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
            aria-hidden
          />
        </Button>
      )}
    </section>
  );
}

/**
 * Visibility (cohort/scope sharing). An unfenced node is visible to all space
 * readers; linking it to cohort scopes fences it to members-only (RLS). Fetches the
 * space's scopes + this node's current fences on open (write = `space.knowledge.access`,
 * gated by RLS on the link table). No cohorts defined → an honest empty note.
 */
function VisibilitySection({
  t,
  spaceId,
  nodeId,
  disabled,
  onMutated,
}: {
  t: ReturnType<typeof createGraphTranslator>;
  spaceId: string;
  nodeId: string;
  disabled: boolean;
  onMutated: () => void;
}) {
  const [choices, setChoices] = React.useState<ScopeChoice[] | null>(null);
  const [floor, setFloor] = React.useState<ResourceFloor | null>(null);
  const [working, setWorking] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch(
      `/author/graph/visibility?space_id=${encodeURIComponent(spaceId)}&node_id=${encodeURIComponent(nodeId)}`
    );
    if (res.ok) {
      const data = (await res.json()) as {
        choices: ScopeChoice[];
        floor: ResourceFloor | null;
      };
      setChoices(data.choices);
      setFloor(data.floor);
    } else {
      setChoices([]);
      setFloor(null);
    }
  }, [spaceId, nodeId]);

  React.useEffect(() => {
    setChoices(null);
    setFloor(null);
    void load();
  }, [load]);

  async function toggle(scopeId: string, linked: boolean) {
    setWorking(true);
    await sendJson(
      '/author/graph/visibility',
      { resourceId: nodeId, scopeId },
      linked ? 'DELETE' : 'POST'
    );
    await load();
    setWorking(false);
    // a cohort grant changes who can see the node → re-resolve the canvas.
    onMutated();
  }

  // The broadcast floor (publish private→space, or restrict space→private). Owner-
  // sovereign (D9): a non-owner/non-admin write is rejected by the DB guard → the
  // select reverts on the reload.
  async function changeFloor(next: ResourceFloor) {
    setWorking(true);
    await sendJson(
      '/author/graph/visibility',
      { resourceId: nodeId, visibility: next },
      'PATCH'
    );
    await load();
    setWorking(false);
    onMutated();
  }

  const linked = (choices ?? []).filter((c) => c.linked);
  const available = (choices ?? []).filter((c) => !c.linked);

  return (
    <section className="flex flex-col gap-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] uppercase">
        <Users className="size-3" aria-hidden />
        {t('graph.panel.visibility')}
      </div>
      {/* broadcast floor — the single per-resource dial (ADR-0017 §1.5). */}
      {floor != null ? (
        <div className="flex flex-col gap-1.5">
          <Select
            value={floor}
            disabled={disabled || working}
            onValueChange={(next) => changeFloor(next as ResourceFloor)}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">
                {t('graph.panel.floorPrivate')}
              </SelectItem>
              <SelectItem value="space">
                {t('graph.panel.floorSpace')}
              </SelectItem>
              <SelectItem value="organization">
                {t('graph.panel.floorOrganization')}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {t('graph.panel.floorHint')}
          </p>
        </div>
      ) : null}
      {choices === null ? null : choices.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t('graph.panel.visibilityNoCohorts')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {linked.length === 0
              ? t('graph.panel.visibilityAll')
              : t('graph.panel.visibilityFenced')}
          </p>
          {linked.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {linked.map((choice) => (
                <Badge key={choice.id} variant="secondary" className="gap-1">
                  {choice.name}
                  <Hint label={t('graph.panel.removeCohort')}>
                    <button
                      type="button"
                      disabled={disabled || working}
                      onClick={() => toggle(choice.id, true)}
                      aria-label={t('graph.panel.removeCohort')}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </Hint>
                </Badge>
              ))}
            </div>
          ) : null}
          {available.length > 0 ? (
            <Select
              value=""
              disabled={disabled || working}
              onValueChange={(scopeId) => toggle(scopeId, false)}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder={t('graph.panel.addCohort')} />
              </SelectTrigger>
              <SelectContent>
                {available.map((choice) => (
                  <SelectItem key={choice.id} value={choice.id}>
                    {choice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      )}
    </section>
  );
}

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
function VersionsSection({
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

  React.useEffect(() => {
    setVersions(null);
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
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] uppercase">
        <History className="size-3" aria-hidden />
        {t('graph.panel.versions')}
      </div>
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
