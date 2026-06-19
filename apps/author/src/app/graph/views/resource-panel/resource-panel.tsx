'use client';

import type { NeighborhoodResult } from '@workspace/knowledge-contracts';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { FacetChip } from '@workspace/ui/components/facet-chip';
import { Input } from '@workspace/ui/components/input';
import { Label } from '@workspace/ui/components/label';
import { RailSectionHeading } from '@workspace/ui/components/rail-section-heading';
import { SectionHeadingRow } from '@workspace/ui/components/section-heading-row';
import { Separator } from '@workspace/ui/components/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@workspace/ui/components/sheet';
import { Textarea } from '@workspace/ui/components/textarea';
import {
  BookOpen,
  Check,
  CircleCheck,
  ClockAlert,
  Download,
  ExternalLink,
  Eye,
  Folder,
  Loader,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Unlink,
  UserRound,
  X,
} from 'lucide-react';
import * as React from 'react';

import type {
  KbAttributes,
  NodeHealth,
  NodeMeta,
  ResourceTag,
} from '@/app/graph/graph-page.data';
import {
  mockEmbedStatus,
  mockSuggestedLinks,
  type MockEmbedStatus,
  type MockSuggestedLink,
} from './kb-rag-mock';
import {
  childContent,
  childFolders,
  groupForNeighbor,
  iconForKind,
  kindLabel,
  parentFolder,
  type Containment,
} from '@/app/graph/views/lens';
import { NodePicker, type PickableNode } from './node-picker';
import { ResourceMiniGraph } from './resource-mini-graph';

/**
 * ResourcePanel — the FULL prototype ResourcePanel (slice-11 Ф2 §5). Opens on
 * node selection; shows header (kind label + status + media meta), title (rename),
 * an EditableDescription (the RAG-bound, stored field — written to the attributes
 * route), TagEditor (tagged edges), NodeHealth (provenance + views from the KB
 * satellites + DERIVED stale/orphan), owner/updated, connections + MiniGraph (one
 * `resolveNeighborhood`), related list + NodePicker (relates_to add/remove), parent
 * "Lives in" and folder Contents (FORWARD `contains`), and Open/Link/More. On open
 * it increments the REAL view counter (attributes route, server-side under RLS).
 *
 * RAG-3 (EmbedStatus + SuggestedLinks + Reindex) has no vector pipeline, so it is
 * rendered against DETERMINISTIC, explicitly-LABELLED mocks (`kb-rag-mock`) to reach
 * pixel-1:1 and surface the gap for the owner (directive Ф3 §3): EmbedStatus is a
 * fixed `indexed` pill; SuggestedLinks is a client-side shared-tag heuristic (its
 * CONFIRM is real — a landed `relates_to` write). poc-no-fallbacks is relaxed ONLY
 * for these marked mocks. The description text is REAL (stored) — the seam is ready;
 * when a vector backend lands, the mocks are deleted and the shape is unchanged.
 *
 * Every mutation is a THIN POST to a landed RLS write-route; after success the panel
 * refetches its neighborhood and the container refreshes the canvas. RLS is the sole
 * write authority — a reader's POST fails cleanly (422), the graph unchanged.
 */

type SelectedNode = {
  id: string;
  title: string;
  kind: string;
  status: string;
};

export type ResourcePanelProps = {
  spaceId: string;
  t: GraphTranslator;
  node: SelectedNode | null;
  attributes?: KbAttributes;
  health?: NodeHealth;
  meta?: NodeMeta;
  currentUserId: string | null;
  containment: Containment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (nodeId: string) => void;
  onMutated: () => void;
  /** Per-item tags (for the MOCKED shared-tag suggested-links heuristic). */
  tagsByItem?: Record<string, ResourceTag[]>;
};

async function postJson(url: string, body: unknown, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function ResourcePanel({
  spaceId,
  t,
  node,
  attributes,
  health,
  meta,
  currentUserId,
  containment,
  open,
  onOpenChange,
  onSelect,
  onMutated,
  tagsByItem,
}: ResourcePanelProps) {
  const [neighborhood, setNeighborhood] =
    React.useState<NeighborhoodResult | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);

  const loadNeighborhood = React.useCallback(async () => {
    if (!node) {
      return;
    }
    const params = new URLSearchParams({
      space_id: spaceId,
      node_id: node.id,
      rel: 'relates_to,tagged,part_of',
      dir: 'both',
      depth: '1',
    });
    const res = await fetch(`/author/graph/neighborhood?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      setNeighborhood((await res.json()) as NeighborhoodResult);
    }
  }, [node, spaceId]);

  // On open: load the neighborhood AND increment the REAL view counter (the
  // counter RLS mirrors node READ — a readable node may be counted; never a fake
  // number, never service-role). Dedup per-open is the effect's job.
  React.useEffect(() => {
    if (open && node) {
      setTitleDraft(node.title);
      setRenaming(false);
      setPicker(false);
      setError(false);
      void loadNeighborhood();
      void postJson('/author/graph/attributes', {
        attribute: 'view',
        spaceId,
        nodeId: node.id,
      });
    }
  }, [open, node, spaceId, loadNeighborhood]);

  const afterMutation = React.useCallback(
    async (ok: boolean) => {
      setBusy(false);
      if (!ok) {
        setError(true);
        return;
      }
      setError(false);
      await loadNeighborhood();
      onMutated();
    },
    [loadNeighborhood, onMutated]
  );

  if (!node) {
    return null;
  }

  const related =
    neighborhood?.neighbors.filter((n) => groupForNeighbor(n) === 'related') ??
    [];
  const tags =
    neighborhood?.neighbors.filter((n) => groupForNeighbor(n) === 'tags') ?? [];
  const KindIcon = iconForKind(node.kind);
  const editable = node.kind !== 'folder' && node.kind !== 'tag';
  const containmentParent = parentFolder(containment, node.id);
  const folderChildren =
    node.kind === 'folder'
      ? [
          ...childFolders(containment, node.id),
          ...childContent(containment, node.id),
        ]
      : [];

  async function onRename() {
    setBusy(true);
    const ok = await postJson(
      '/author/graph/resources',
      { spaceId, resourceId: node!.id, title: titleDraft },
      'PATCH'
    );
    setRenaming(false);
    await afterMutation(ok);
  }

  async function onTransition(toStatus: string) {
    setBusy(true);
    const ok = await postJson('/author/graph/transition', {
      spaceId,
      resourceId: node!.id,
      toStatus,
    });
    await afterMutation(ok);
  }

  async function onAddTag(tagTitle: string) {
    setBusy(true);
    const ok = await postJson('/author/graph/edges', {
      action: 'tag',
      spaceId,
      resourceId: node!.id,
      tagTitle,
    });
    await afterMutation(ok);
  }

  async function onUntag(tagId: string) {
    setBusy(true);
    const ok = await postJson(
      '/author/graph/edges',
      { spaceId, fromId: node!.id, toId: tagId, relationType: 'tagged' },
      'DELETE'
    );
    await afterMutation(ok);
  }

  async function onAddLink(target: PickableNode) {
    setBusy(true);
    setPicker(false);
    const ok = await postJson('/author/graph/edges', {
      action: 'link',
      spaceId,
      fromId: node!.id,
      toId: target.id,
    });
    await afterMutation(ok);
  }

  async function onUnlink(targetId: string) {
    setBusy(true);
    const ok = await postJson(
      '/author/graph/edges',
      { spaceId, fromId: node!.id, toId: targetId, relationType: 'relates_to' },
      'DELETE'
    );
    await afterMutation(ok);
  }

  async function onSaveDescription(body: string) {
    setBusy(true);
    const ok = await postJson('/author/graph/attributes', {
      attribute: 'description',
      spaceId,
      nodeId: node!.id,
      body,
    });
    await afterMutation(ok);
  }

  const ownerLabel =
    meta?.ownerUserId && currentUserId && meta.ownerUserId === currentUserId
      ? t('graph.panel.ownerYou')
      : t('graph.panel.ownerMember');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetDescription className="text-muted-foreground flex items-center gap-2 text-xs tracking-wide uppercase">
            <KindIcon className="size-4" aria-hidden />
            {kindLabel(t, node.kind)}
          </SheetDescription>
          {renaming ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="rename-input" className="sr-only">
                {t('graph.panel.rename')}
              </Label>
              <Input
                id="rename-input"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                disabled={busy}
              />
              <Button
                size="icon-sm"
                onClick={onRename}
                disabled={busy || titleDraft.trim().length === 0}
                aria-label={t('graph.panel.rename')}
              >
                <Check className="size-4" aria-hidden />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setRenaming(false)}
                disabled={busy}
                aria-label={t('graph.panel.cancel')}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <SheetTitle className="text-left">{node.title}</SheetTitle>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  setTitleDraft(node.title);
                  setRenaming(true);
                }}
                aria-label={t('graph.panel.rename')}
              >
                <Pencil className="size-4" aria-hidden />
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{node.status}</Badge>
            {attributes?.link?.host ? (
              <span className="text-muted-foreground text-xs">
                {attributes.link.host}
              </span>
            ) : null}
            {attributes?.media?.mimeType ? (
              <span className="text-muted-foreground text-xs">
                {attributes.media.mimeType}
              </span>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 py-4">
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {t('graph.panel.mutationError')}
            </p>
          ) : null}

          {/* editable, RAG-bound description (stored). EmbedStatus is MOCKED —
              no vector backend (see kb-rag-mock); labelled, not silently faked. */}
          <EditableDescription
            t={t}
            value={attributes?.description ?? ''}
            nodeId={node.id}
            disabled={busy}
            onSave={onSaveDescription}
          />

          {/* status transition */}
          <section className="flex flex-col gap-2">
            <RailSectionHeading>{t('graph.panel.status')}</RailSectionHeading>
            <div className="flex flex-wrap gap-1.5">
              {['draft', 'in_review', 'approved', 'active'].map((status) => (
                <Button
                  key={status}
                  size="xs"
                  variant={status === node.status ? 'secondary' : 'outline'}
                  disabled={busy || status === node.status}
                  onClick={() => onTransition(status)}
                >
                  {status}
                </Button>
              ))}
            </div>
          </section>

          {/* tags */}
          <section className="flex flex-col gap-2">
            <RailSectionHeading>{t('graph.panel.tags')}</RailSectionHeading>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <FacetChip
                  key={tag.edge_id}
                  label={tag.node.title}
                  onRemove={() => onUntag(tag.node.id)}
                  removeLabel={t('graph.panel.removeTag')}
                />
              ))}
              {tags.length === 0 ? (
                <span className="text-muted-foreground text-xs">
                  {t('graph.panel.noTags')}
                </span>
              ) : null}
            </div>
            <TagAdder t={t} disabled={busy} onAdd={onAddTag} />
          </section>

          {/* owner + updated */}
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <UserRound className="size-3.5" aria-hidden />
            <span>{ownerLabel}</span>
          </div>

          {/* node health: provenance + stale/orphan + views (NO embed — RAG seam) */}
          <NodeHealthBadges t={t} attributes={attributes} health={health} />

          {/* actions */}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1">
              {node.kind === 'link' ? (
                <ExternalLink className="size-4" aria-hidden />
              ) : (
                <BookOpen className="size-4" aria-hidden />
              )}
              {t('graph.panel.open')}
            </Button>
            {editable ? (
              <Button
                size="sm"
                variant={picker ? 'secondary' : 'outline'}
                onClick={() => setPicker((value) => !value)}
              >
                <Plus className="size-4" aria-hidden />
                {t('graph.panel.addLink')}
              </Button>
            ) : null}
          </div>

          <Separator />

          {/* connections mini-graph */}
          <section className="flex flex-col gap-2">
            <RailSectionHeading>
              {t('graph.panel.connections')}
            </RailSectionHeading>
            {neighborhood ? (
              <ResourceMiniGraph
                centerTitle={node.title}
                neighborhood={neighborhood}
                emptyLabel={t('graph.panel.noConnections')}
              />
            ) : null}
          </section>

          {/* related documents (editable: add/remove relates_to) */}
          {editable ? (
            <section className="flex flex-col gap-2">
              <RailSectionHeading>
                {t('graph.panel.related')}
              </RailSectionHeading>
              {picker ? (
                <NodePicker
                  spaceId={spaceId}
                  t={t}
                  excludeIds={[node.id, ...related.map((r) => r.node.id)]}
                  disabled={busy}
                  onPick={onAddLink}
                />
              ) : null}
              <ul className="flex flex-col gap-1">
                {related.map((rel) => (
                  <li
                    key={rel.edge_id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(rel.node.id)}
                      className="hover:text-foreground truncate text-left"
                    >
                      {rel.node.title}
                    </button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onUnlink(rel.node.id)}
                      disabled={busy}
                      aria-label={t('graph.panel.removeLink')}
                    >
                      <X className="size-3" aria-hidden />
                    </Button>
                  </li>
                ))}
                {related.length === 0 && !picker ? (
                  <li className="text-muted-foreground text-xs">
                    {t('graph.panel.noRelated')}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {/* MOCKED suggested links — shared-tag heuristic, NOT a vector search
              (kb-rag-mock; labelled, for owner discussion — no vector backend). */}
          {editable ? (
            <SuggestedLinksSection
              t={t}
              nodeId={node.id}
              tagsByItem={tagsByItem}
              containment={containment}
              excludeIds={[node.id, ...related.map((r) => r.node.id)]}
              disabled={busy}
              onSelect={onSelect}
              onConfirm={onAddLink}
            />
          ) : null}

          {/* folder contents */}
          {folderChildren.length > 0 ? (
            <section className="flex flex-col gap-2">
              <RailSectionHeading>
                {t('graph.panel.contents', { count: folderChildren.length })}
              </RailSectionHeading>
              <ul className="flex flex-col gap-1">
                {folderChildren.map((child) => {
                  const ChildIcon = iconForKind(child.kind);
                  return (
                    <li key={child.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(child.id)}
                        className="hover:text-foreground flex w-full items-center gap-2 truncate text-left text-sm"
                      >
                        <ChildIcon
                          className="text-muted-foreground size-4 shrink-0"
                          aria-hidden
                        />
                        <span className="truncate">{child.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {/* lives in (parent folder) */}
          {containmentParent ? (
            <section className="flex flex-col gap-2">
              <RailSectionHeading>{t('graph.panel.parent')}</RailSectionHeading>
              <button
                type="button"
                onClick={() => onSelect(containmentParent.id)}
                className="hover:text-foreground flex items-center gap-2 truncate text-left text-sm"
              >
                <Folder
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden
                />
                <span className="truncate">{containmentParent.title}</span>
              </button>
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Editable, RAG-bound description (slice-11 Ф2 §5). Saved on Save/⌘↵. The vector
 * index status/reindex is NOT shown — RAG seam (poc-no-fallbacks). */
function EditableDescription({
  t,
  value,
  nodeId,
  disabled,
  onSave,
}: {
  t: GraphTranslator;
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
      <div className="flex items-center gap-2">
        <SectionHeadingRow
          uppercase
          icon={<Sparkles className="size-3" aria-hidden />}
        >
          {t('graph.panel.description')}
        </SectionHeadingRow>
        <EmbedStatusBadge t={t} status={mockEmbedStatus()} />
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
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="hover:border-ring hover:bg-accent flex w-full items-start gap-2 rounded-md border border-dashed p-2.5 text-left text-sm"
        >
          <span
            className={
              value
                ? 'text-muted-foreground flex-1'
                : 'text-muted-foreground/70 flex-1'
            }
          >
            {value || t('graph.panel.descriptionEmpty')}
          </span>
          <Pencil
            className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
            aria-hidden
          />
        </button>
      )}
    </section>
  );
}

/** Provenance + stale/orphan + views badges (slice-11 Ф2 §5). NO embed status —
 * that is a RAG seam with no vector pipeline (poc-no-fallbacks). */
function NodeHealthBadges({
  t,
  attributes,
  health,
}: {
  t: GraphTranslator;
  attributes?: KbAttributes;
  health?: NodeHealth;
}) {
  const source = attributes?.provenance ?? 'human';
  const ProvenanceIcon =
    source === 'imported' ? Download : source === 'ai' ? Sparkles : UserRound;
  const provenanceLabel =
    source === 'imported'
      ? t('graph.panel.provenanceImported')
      : source === 'ai'
        ? t('graph.panel.provenanceAi')
        : t('graph.panel.provenanceHuman');
  const stale = health?.stale ?? false;
  const orphan = health?.orphan ?? false;
  const views = attributes?.viewCount ?? 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline" className="gap-1">
        <ProvenanceIcon className="size-3" aria-hidden />
        {provenanceLabel}
      </Badge>
      <Badge variant="outline" className="gap-1">
        {stale ? (
          <ClockAlert className="size-3" aria-hidden />
        ) : (
          <CircleCheck className="size-3" aria-hidden />
        )}
        {stale
          ? t('graph.panel.healthNeedsReview')
          : t('graph.panel.healthFresh')}
      </Badge>
      {orphan ? (
        <Badge variant="outline" className="gap-1">
          <Unlink className="size-3" aria-hidden />
          {t('graph.panel.healthNotLinked')}
        </Badge>
      ) : null}
      {views > 0 ? (
        <Badge variant="outline" className="gap-1">
          <Eye className="size-3" aria-hidden />
          {t('graph.panel.views', { count: views })}
        </Badge>
      ) : null}
    </div>
  );
}

/** A tiny inline tag adder (title → two-step tag create+edge). */
function TagAdder({
  t,
  disabled,
  onAdd,
}: {
  t: GraphTranslator;
  disabled: boolean;
  onAdd: (title: string) => void;
}) {
  const [value, setValue] = React.useState('');
  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('graph.panel.addTag')}
        disabled={disabled}
        className="h-8"
      />
      <Button
        size="icon-sm"
        variant="outline"
        disabled={disabled || value.trim().length === 0}
        onClick={() => {
          onAdd(value.trim());
          setValue('');
        }}
        aria-label={t('graph.panel.addTag')}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

/**
 * EmbedStatusBadge — the prototype EmbedStatus pill, MOCKED (slice-11 Ф3 §3). There
 * is NO vector index, so the status is a deterministic stub from `kb-rag-mock`
 * (`indexed`). The pill is explicitly labelled as a vector-index indicator; the
 * `stale` branch offers a Reindex affordance (also a mock — it cannot enqueue a real
 * job). poc-no-fallbacks is relaxed ONLY for this clearly-marked stub (owner
 * directive Ф3). When a real pipeline lands, read the real status here.
 */
function EmbedStatusBadge({
  t,
  status,
}: {
  t: GraphTranslator;
  status: MockEmbedStatus;
}) {
  // MOCK — pending vector backend (slice-11), for owner discussion.
  if (status === 'indexing') {
    return (
      <span className="text-muted-foreground ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
        <Loader className="size-3 animate-spin" aria-hidden />
        {t('graph.panel.embedIndexing')}
      </span>
    );
  }
  if (status === 'stale') {
    return (
      <span
        title={t('graph.panel.embedReindexHint')}
        className="bg-accent text-foreground ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
      >
        <RefreshCw className="size-3" aria-hidden />
        {t('graph.panel.embedReindex')}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
      <CircleCheck className="size-3" aria-hidden />
      {t('graph.panel.embedIndexed')}
    </span>
  );
}

/**
 * SuggestedLinksSection — the prototype SuggestedLinks block, MOCKED (slice-11 Ф3
 * §3). Suggestions come from a CLIENT-SIDE shared-tag HEURISTIC (`kb-rag-mock`), NOT
 * a vector `similar` search — exactly the kind of heuristic the prototype itself
 * used. The confirm action is REAL (it creates a `relates_to` edge via the landed
 * route); dismiss is local. The section is labelled so the gap is visible for owner
 * discussion (poc-no-fallbacks relaxed only for this marked mock).
 */
function SuggestedLinksSection({
  t,
  nodeId,
  tagsByItem,
  containment,
  excludeIds,
  disabled,
  onSelect,
  onConfirm,
}: {
  t: GraphTranslator;
  nodeId: string;
  tagsByItem?: Record<string, ResourceTag[]>;
  containment: Containment;
  excludeIds: string[];
  disabled: boolean;
  onSelect: (nodeId: string) => void;
  onConfirm: (target: PickableNode) => void;
}) {
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  React.useEffect(() => setDismissed(new Set()), [nodeId]);

  // MOCK — pending vector backend (slice-11): shared-tag heuristic, not vectors.
  const titleById = React.useMemo(() => {
    const map = new Map<string, { title: string; kind: string }>();
    for (const node of containment.byId.values()) {
      map.set(node.id, { title: node.title, kind: node.kind });
    }
    return map;
  }, [containment]);

  const suggestions: MockSuggestedLink[] = React.useMemo(
    () =>
      mockSuggestedLinks({
        nodeId,
        tagsByItem: tagsByItem ?? {},
        titleById,
        excludeIds: new Set([...excludeIds, ...dismissed]),
      }),
    [nodeId, tagsByItem, titleById, excludeIds, dismissed]
  );

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionHeadingRow icon={<Sparkles className="size-3" aria-hidden />}>
        {t('graph.panel.suggestedLinks')}
      </SectionHeadingRow>
      <ul className="flex flex-col gap-1.5">
        {suggestions.map((suggestion) => {
          const Icon = iconForKind(suggestion.kind);
          return (
            <li
              key={suggestion.id}
              className="flex items-center gap-2 rounded-md border border-dashed p-2"
            >
              <Icon
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden
              />
              <button
                type="button"
                onClick={() => onSelect(suggestion.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm font-medium">
                  {suggestion.title}
                </div>
                <div className="text-muted-foreground truncate text-[11px]">
                  {t('graph.panel.suggestedReasonTag', {
                    tag: suggestion.reasonTagTitle,
                  })}
                </div>
              </button>
              <Button
                size="icon-xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  onConfirm({
                    id: suggestion.id,
                    title: suggestion.title,
                    kind: suggestion.kind,
                  })
                }
                aria-label={t('graph.panel.suggestedConfirm')}
              >
                <Check className="size-3.5" aria-hidden />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() =>
                  setDismissed((prev) => new Set([...prev, suggestion.id]))
                }
                aria-label={t('graph.panel.suggestedDismiss')}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
