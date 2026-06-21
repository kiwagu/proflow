'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { ConfirmDialog } from '@workspace/ui/components/confirm-dialog';
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
  Check,
  Eye,
  History,
  Pencil,
  RotateCcw,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';

import { type Containment } from '@/app/graph/containment';
import { NodeActionsMenu } from '@/app/graph/node-actions-menu';
import {
  DocumentBodyView,
  type SerializedLexical,
} from '@/app/graph/views/document-reader/document-body-view';
import type { KbAttributes, ScopeChoice } from '@/app/graph/graph-data.types';
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-run the server resolve after a mutation (the workbench refreshes). */
  onMutated: () => void;
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
  open,
  onOpenChange,
  onMutated,
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
          onMutated={onMutated}
          onActed={() => onOpenChange(false)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          aria-label={t('graph.panel.close')}
        >
          <X className="size-4" aria-hidden />
        </Button>
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
          <VersionsSection t={t} spaceId={spaceId} nodeId={node.id} />
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
  const [working, setWorking] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await fetch(
      `/author/graph/visibility?space_id=${encodeURIComponent(spaceId)}&node_id=${encodeURIComponent(nodeId)}`
    );
    setChoices(
      res.ok ? ((await res.json()) as { choices: ScopeChoice[] }).choices : []
    );
  }, [spaceId, nodeId]);

  React.useEffect(() => {
    setChoices(null);
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
    // fencing changes who can see the node → re-resolve the canvas.
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
                  <button
                    type="button"
                    disabled={disabled || working}
                    onClick={() => toggle(choice.id, true)}
                    aria-label={t('graph.panel.removeCohort')}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
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
 * Versions — the tangible draft/publish history for a `kind=text` node's body
 * (Payload records a version on every save). Read-only list, fetched on demand
 * when the panel opens. Shows each version's draft/published status + time so the
 * moderator sees the workflow concretely. Reads are RLS-gated server-side.
 */
function VersionsSection({
  t,
  spaceId,
  nodeId,
}: {
  t: ReturnType<typeof createGraphTranslator>;
  spaceId: string;
  nodeId: string;
}) {
  const [versions, setVersions] = React.useState<VersionEntry[] | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [viewBody, setViewBody] = React.useState<SerializedLexical | null>(
    null
  );
  const [viewOpen, setViewOpen] = React.useState(false);

  const base = `node_id=${encodeURIComponent(nodeId)}&space_id=${encodeURIComponent(spaceId)}`;

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

  async function viewVersion(id: string) {
    const res = await fetch(
      `/author/graph/text-resources/versions?${base}&version_id=${encodeURIComponent(id)}`
    );
    if (res.ok) {
      setViewBody(
        ((await res.json()) as { body: SerializedLexical | null }).body ?? null
      );
      setViewOpen(true);
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
          {versions.map((v) => (
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
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => void viewVersion(v.id)}
                aria-label={t('graph.panel.versionView')}
              >
                <Eye className="size-3.5" aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setConfirmId(v.id)}
                aria-label={t('graph.panel.versionRestore')}
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </Button>
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

      {/* Version preview — a CONTAINED modal (clearly a preview), at the SAME
          reading width as the reader (the viewer dialog widens + un-pads so the
          shared `DocumentBodyView` column renders identically). */}
      <DocumentViewerDialog
        open={viewOpen}
        onOpenChange={setViewOpen}
        title={t('graph.panel.versionViewTitle')}
      >
        <DocumentBodyView
          body={viewBody}
          emptyLabel={t('graph.reader.empty')}
        />
      </DocumentViewerDialog>
    </section>
  );
}
