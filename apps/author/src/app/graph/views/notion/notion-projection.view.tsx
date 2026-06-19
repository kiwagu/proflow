'use client';

import type {
  NeighborhoodResult,
  Neighbor,
} from '@workspace/knowledge-contracts';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { CardTile } from '@workspace/ui/components/card-tile';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { cn } from '@workspace/ui/lib/utils';
import {
  AtSign,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  Download,
  ExternalLink,
  FileText,
  Info,
  Plus,
  Search,
} from 'lucide-react';
import * as React from 'react';

import type { ProjectionViewProps } from '@/app/graph/views/registry';
import {
  buildContainment,
  childrenNodes,
  iconForKind,
  LensCreateResource,
  parentFolder,
  pathTo,
  rootFolders,
  type Containment,
  type CreateRequest,
  type LensNode,
} from '@/app/graph/views/lens';
import {
  mockNotionBody,
  type MockBodyParagraph,
  type MockMentionTarget,
} from './kb-notion-body-mock';

/**
 * NotionProjectionView — the prototype `NotionView`, pixel-1:1 (slice-11 Ф4 §1,
 * ADR-0014 `view='notion'`). The "Notion" projection over the SAME graph: there are
 * no folders in the UI vocabulary — everything is a "page". Pages NEST inside pages
 * (the FORWARD `contains` forest, ADR-0015) and REFERENCE each other (`relates_to`).
 * A 250px page tree on the left; a centered reading canvas on the right showing the
 * open page's breadcrumb, title, tags, description, body, inline mentions and a
 * "Linked references" (backlinks) section. The same graph, read as documents that
 * link documents.
 *
 * PURELY presentational (ADR-0005 §b): it consumes the resolved canvas + the
 * server-loaded `contains` forest (`kbData`) for nesting; it pulls the open page's
 * neighborhood through the landed `/author/graph/neighborhood` route (out-`relates_to`
 * = mentions, in-`relates_to` = backlinks — `dir=both`, ONE call) exactly as the
 * panel does. It never queries Supabase or the resolver directly. RLS is the sole
 * authority — an ungranted user resolves to an empty tree and an empty canvas.
 *
 * Backlinks + the mentions CALLOUT are REAL (landed `relates_to` edges). The page
 * BODY and the INLINE placement of mentions within it are MOCKED (`kb-notion-body-mock`)
 * — the Lexical body read-path + inline mention anchors are not built (slice-11 §5
 * gap 3 / OPEN DECISION 3). The mock is deterministic and explicitly labelled, never
 * a silent fake (owner directive Ф4 §2).
 *
 * In the prototype the shared ResourcePanel is NOT shown in Notion (`variant !==
 * "notion"`): description/health are embedded in the canvas. We keep that 1:1 — the
 * workbench suppresses the drawer for this variant; selecting a backlink/mention just
 * re-opens that page in the canvas (`onSelect`).
 *
 * Sizes/spacing/typography match the prototype exactly (250px tree, 720px canvas,
 * 44/56px padding, 13px breadcrumb, full-round mention chips, etc.); color is always
 * a token so dark mode works.
 */

export function NotionProjectionView({
  result,
  messages,
  selectedId,
  onSelect,
  onMutated,
  spaceId,
  kbData,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const containment = React.useMemo(
    () => buildContainment(result.items, kbData?.containment ?? []),
    [result.items, kbData?.containment]
  );

  // The open page: the shared selection if it is a real node, else the first root
  // folder's first child (or the first root). The prototype defaults to "d-welcome";
  // here we default to the first available page so an arbitrary seed works 1:1.
  const fallbackId = React.useMemo(
    () => firstPageId(containment),
    [containment]
  );
  const openId =
    selectedId && containment.byId.has(selectedId) ? selectedId : fallbackId;
  const openNode = openId ? containment.byId.get(openId) : undefined;

  // expanded folders: default-expand the one containing the open page.
  const parent = openId ? parentFolder(containment, openId) : null;
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => {
    if (parent) {
      return new Set([parent.id]);
    }
    const firstRoot = rootFolders(containment)[0];
    return new Set(firstRoot ? [firstRoot.id] : []);
  });
  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const [createRequest, setCreateRequest] =
    React.useState<CreateRequest | null>(null);

  const roots = rootFolders(containment);

  if (!spaceId) {
    return null;
  }

  const tree = (
    <div className="flex flex-col gap-px">
      <div className="text-muted-foreground flex items-center gap-2 px-2 pt-1 pb-2.5">
        <Search className="size-[15px]" aria-hidden />
        <span className="text-sm">{t('graph.notion.searchPages')}</span>
      </div>
      {roots.map((folder) => {
        const open = expanded.has(folder.id);
        const kids = childrenNodes(containment, folder.id).filter(
          (n) => n.kind !== 'tag'
        );
        return (
          <div key={folder.id}>
            <div className="text-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-[5px]">
              <button
                type="button"
                onClick={() => toggle(folder.id)}
                aria-label={t('graph.notion.toggleSection')}
                aria-expanded={open}
                className="grid size-[18px] shrink-0 place-items-center"
              >
                {open ? (
                  <ChevronDown
                    className="text-muted-foreground size-3.5"
                    aria-hidden
                  />
                ) : (
                  <ChevronRight
                    className="text-muted-foreground size-3.5"
                    aria-hidden
                  />
                )}
              </button>
              <FileText
                className="text-muted-foreground size-[15px]"
                aria-hidden
              />
              <span className="flex-1 truncate text-sm font-medium">
                {folder.title}
              </span>
            </div>
            {open
              ? kids.map((kid) => {
                  const KidIcon = iconForKind(kid.kind);
                  const active = openId === kid.id;
                  return (
                    <button
                      key={kid.id}
                      type="button"
                      onClick={() => onSelect(kid.id)}
                      data-active={active}
                      className={cn(
                        'hover:bg-accent flex w-full items-center gap-1.5 rounded-md py-[5px] pr-2 pl-[30px] text-left',
                        active ? 'bg-accent' : 'bg-transparent'
                      )}
                    >
                      <KidIcon
                        className="text-muted-foreground size-[15px]"
                        aria-hidden
                      />
                      <span className="flex-1 truncate text-sm">
                        {kid.title}
                      </span>
                    </button>
                  );
                })
              : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          setCreateRequest({
            kind: 'text',
            parentFolderId: parent?.id ?? null,
          })
        }
        className="hover:bg-accent text-muted-foreground mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-[5px] text-left"
      >
        <Plus className="size-[15px]" aria-hidden />
        <span className="text-sm">{t('graph.notion.newPage')}</span>
      </button>
    </div>
  );

  // The reader centers itself with its own generous padding, so the shared main
  // region runs full-bleed (the article owns its inset) and scrolls internally.
  const main = (
    <div className="size-full overflow-y-auto">
      {openNode ? (
        <NotionReader
          t={t}
          spaceId={spaceId}
          node={openNode}
          containment={containment}
          tags={kbData?.tagsByItem[openNode.id] ?? []}
          description={kbData?.attributesByItem[openNode.id]?.description}
          meta={kbData?.metaByItem[openNode.id]}
          onSelect={onSelect}
        />
      ) : (
        <p className="text-muted-foreground p-12 text-center text-sm">
          {t('graph.lens.emptyEditor')}
        </p>
      )}
    </div>
  );

  return (
    <>
      <WorkbenchShell
        panel={{
          kind: 'fixed',
          width: 250,
          'aria-label': t('graph.notion.searchPages'),
          className: 'gap-px',
          children: tree,
        }}
        main={main}
        bleed
      />

      <LensCreateResource
        spaceId={spaceId}
        t={t}
        containment={containment}
        request={createRequest}
        onOpenChange={(open) => {
          if (!open) {
            setCreateRequest(null);
          }
        }}
        onCreated={onMutated}
      />
    </>
  );
}

// ── reading canvas (prototype NotionReader) ───────────────────────────────

function NotionReader({
  t,
  spaceId,
  node,
  containment,
  tags,
  description,
  meta,
  onSelect,
}: {
  t: GraphTranslator;
  spaceId: string;
  node: LensNode;
  containment: Containment;
  tags: { id: string; title: string }[];
  description?: string;
  meta?: { ownerUserId: string | null; updatedAt: string };
  onSelect: (nodeId: string) => void;
}) {
  // REAL mentions (out-relates_to) + REAL backlinks (in-relates_to) from the landed
  // neighborhood port (dir=both, ONE call) — the same edges, two directions.
  const [neighborhood, setNeighborhood] =
    React.useState<NeighborhoodResult | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      space_id: spaceId,
      node_id: node.id,
      rel: 'relates_to',
      dir: 'both',
      depth: '1',
    });
    void fetch(`/author/graph/neighborhood?${params}`, {
      headers: { Accept: 'application/json' },
    }).then(async (res) => {
      if (res.ok && !cancelled) {
        setNeighborhood((await res.json()) as NeighborhoodResult);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [spaceId, node.id]);

  const mentions: Neighbor[] =
    neighborhood?.neighbors.filter(
      (n) => n.relation_type === 'relates_to' && n.direction === 'outgoing'
    ) ?? [];
  const backlinks: Neighbor[] =
    neighborhood?.neighbors.filter(
      (n) => n.relation_type === 'relates_to' && n.direction === 'incoming'
    ) ?? [];

  const path = pathTo(containment, node.id);
  const isDoc = node.kind === 'text' || node.kind === 'folder';

  // MOCK — pending backend (slice-11): the page body + the inline anchoring of its
  // (real) mentions. Deterministic, labelled (see kb-notion-body-mock). The mention
  // TARGETS are the real out-relates_to neighbors; the memo recomputes only when the
  // open node or its loaded neighborhood changes.
  const mockBody: MockBodyParagraph[] = React.useMemo(() => {
    const mentionTargets: MockMentionTarget[] = (neighborhood?.neighbors ?? [])
      .filter(
        (n) => n.relation_type === 'relates_to' && n.direction === 'outgoing'
      )
      .map((m) => ({ id: m.node.id, title: m.node.title }));
    return mockNotionBody({ title: node.title, mentions: mentionTargets });
  }, [node.title, neighborhood]);

  const editedLabel = meta
    ? t('graph.notion.editedBy', {
        updated: relativeUpdated(meta.updatedAt),
        owner: t('graph.panel.ownerMember'),
      })
    : '';

  return (
    <article className="mx-auto max-w-[720px] px-14 py-11">
      {/* breadcrumb */}
      <div className="text-muted-foreground mb-[22px] flex flex-wrap items-center gap-1 text-[13px]">
        {path.map((p, i) => (
          <React.Fragment key={p.id}>
            {i > 0 ? (
              <ChevronRight
                className="text-muted-foreground size-3.5"
                aria-hidden
              />
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(p.id)}
              className={cn(
                i === path.length - 1
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.title}
            </button>
          </React.Fragment>
        ))}
      </div>

      <h1 className="mb-3.5 text-4xl leading-[1.1] font-bold tracking-tight">
        {node.title}
      </h1>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <Badge key={tag.id} variant="secondary">
            {tag.title}
          </Badge>
        ))}
        {editedLabel ? (
          <span className="text-muted-foreground text-[13px]">
            {editedLabel}
          </span>
        ) : null}
      </div>

      {/* description (canvas-embedded; the panel is hidden in Notion, 1:1) */}
      {description ? (
        <p className="text-muted-foreground mb-6 text-sm">{description}</p>
      ) : null}

      {/* non-doc asset callout (file/video/link) */}
      {!isDoc ? (
        <div className="bg-muted mb-6 flex items-center gap-3 rounded-lg border p-[18px]">
          <AssetIcon kind={node.kind} />
          <div className="flex-1">
            <div className="text-sm font-medium">{node.title}</div>
            {description ? (
              <div className="text-muted-foreground text-[13px]">
                {description}
              </div>
            ) : null}
          </div>
          <Button size="sm" variant="outline">
            {node.kind === 'link' ? (
              <ExternalLink className="size-[15px]" aria-hidden />
            ) : (
              <Download className="size-[15px]" aria-hidden />
            )}
            {t('graph.notion.openAsset')}
          </Button>
        </div>
      ) : null}

      {/* MOCKED body — page prose + inline mention chips (real targets). Labelled
          so the gap is visible for owner discussion (no Lexical read-path yet). */}
      <div className="mb-2 flex items-center gap-1.5">
        <Info className="text-muted-foreground size-3" aria-hidden />
        <span className="text-muted-foreground text-[11px]">
          {t('graph.notion.mockBodyNote')}
        </span>
      </div>
      {mockBody.map((paragraph, i) => (
        <p key={i} className="text-foreground mb-4 text-base leading-[1.75]">
          {paragraph.runs.map((run, j) =>
            run.type === 'text' ? (
              <React.Fragment key={j}>{run.text}</React.Fragment>
            ) : (
              <Mention
                key={j}
                title={run.title}
                onSelect={() => onSelect(run.id)}
              />
            )
          )}
        </p>
      ))}

      {/* inline mentions callout (REAL out-relates_to) */}
      {mentions.length > 0 ? (
        <div className="bg-muted/40 my-2 mb-7 flex gap-2.5 rounded-lg border p-4">
          <AtSign
            className="text-muted-foreground mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          <div>
            <div className="text-muted-foreground mb-2 text-xs font-semibold">
              {t('graph.notion.mentionsTitle')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mentions.map((m) => (
                <Mention
                  key={m.edge_id}
                  title={m.node.title}
                  onSelect={() => onSelect(m.node.id)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* backlinks (REAL in-relates_to) */}
      {backlinks.length > 0 ? (
        <div className="mt-2 border-t pt-[18px]">
          <div className="text-muted-foreground mb-2.5 flex items-center gap-1.5 text-xs font-semibold">
            <CornerDownLeft className="size-3.5" aria-hidden />
            {backlinks.length === 1
              ? t('graph.notion.backlinksOne')
              : t('graph.notion.backlinksMany', { count: backlinks.length })}
          </div>
          <div className="flex flex-col gap-1.5">
            {backlinks.map((b) => (
              <CardTile
                key={b.edge_id}
                radius="md"
                shadow={false}
                onClick={() => onSelect(b.node.id)}
                className="gap-2.5 px-3 py-2.5 text-left"
              >
                <FileText
                  className="text-muted-foreground size-[15px] shrink-0"
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{b.node.title}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {t('graph.notion.references', { title: node.title })}
                  </div>
                </div>
              </CardTile>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

/** Inline @-mention chip (prototype `Mention`) — full-round, bordered, links to the
 * referenced page. */
function Mention({ title, onSelect }: { title: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="bg-background hover:bg-accent text-foreground inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-[7px] align-baseline text-[13px] transition-colors"
    >
      <FileText className="text-muted-foreground size-3.5" aria-hidden />
      {title}
    </button>
  );
}

function AssetIcon({ kind }: { kind: string }) {
  const Icon = iconForKind(kind);
  return <Icon className="text-foreground size-[22px]" aria-hidden />;
}

/** First openable page: first root folder's first child, else the first root. */
function firstPageId(c: Containment): string | undefined {
  const roots = rootFolders(c);
  for (const root of roots) {
    const kid = childrenNodes(c, root.id).find((n) => n.kind !== 'tag');
    if (kid) {
      return kid.id;
    }
  }
  return roots[0]?.id;
}

/** Relative "2d"/"4h" style label (prototype `updated`). Presentation-only (D). */
function relativeUpdated(updatedAt: string): string {
  const then = Date.parse(updatedAt);
  if (!Number.isFinite(then)) {
    return '';
  }
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${Math.max(minutes, 1)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return `${Math.floor(days / 7)}w`;
}
