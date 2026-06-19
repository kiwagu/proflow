'use client';

import type {
  Neighbor,
  NeighborhoodResult,
} from '@workspace/knowledge-contracts';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Input } from '@workspace/ui/components/input';
import { WorkbenchShell } from '@workspace/ui/components/workbench-shell';
import { cn } from '@workspace/ui/lib/utils';
import {
  ChevronRight,
  Filter,
  Globe,
  LocateFixed,
  Minimize2,
  Minus,
  Plus,
  Route,
  Search,
} from 'lucide-react';
import * as React from 'react';

import {
  adjacencyOf,
  clusterLayout,
  egoLayout,
  EDGE_STYLE,
  type GraphAdjacency,
  type GraphCluster,
  type GraphNode,
  type GraphRel,
} from './graph-layout';
import type { ProjectionViewProps } from '@/app/graph/views/registry';
import {
  buildContainment,
  iconForKind,
  kindLabel,
} from '@/app/graph/views/lens';

/**
 * GraphProjectionView — the prototype `GraphView`, pixel-1:1 (slice-11 Ф5 §1,
 * ADR-0014 `view='graph'`). The "Graph" projection over the SAME graph: a
 * force/radial SPATIAL map. One node sits focused at the centre; its neighbours
 * fan out on concentric rings (radial ego sunburst, depth 1–5); clicking any
 * neighbour RE-CENTERS on it and a breadcrumb PATH-TRAIL records the walk. A
 * facet filter slices the map; a search box jumps focus to any node; an Overview
 * mode force-lays clustered sections for the bird's-eye view; zoom/pan navigate.
 *
 * PURELY presentational (ADR-0005 §b) and Invariant #1 (one entry + one component,
 * zero model/resolver/contract changes). GRAPH DATA IS RLS-BACKED, NEVER MOCKED:
 *  - `relates_to` ⊕ `tagged` edges come from the frozen `neighborhood` engine port
 *    (ADR-0010, `dir=both`, depth ≤ 2) pulled through `/author/graph/neighborhood`;
 *  - `contains` / `shortcut` edges come from the server-loaded RLS-scoped forests
 *    (`kbData.containment` / `kbData.shortcuts`) — the port does not expose them;
 *  - the resolved canvas (`result.items`) bounds the Overview clustering.
 * Only the LAYOUT math is client-side (`graph-layout.ts`) — topology ≠ geometry.
 *
 * RE-CENTER is the deep-walk mechanism (engine-gap 1): clicking a neighbour bubbles
 * `onSelect` → the workbench's shared `selectedId` → the focus changes and this view
 * refetches the new focus's bounded neighbourhood. Depth > 2 in one focus is served
 * by LAZY frontier expansion (fetch each frontier node's depth-1 neighbourhood as
 * the ring grows) — still a sequence of bounded port calls, never one deep fetch.
 * The Overview clustering is client aggregation over the already-resolved set
 * (engine-gap 2). The engine stays frozen; RLS is the sole authority — an ungranted
 * user resolves to an empty set → an empty map.
 *
 * Sizes/radii/ring step/force constants/transitions match the prototype exactly;
 * every colour/shadow/radius is a token so dark mode works.
 */

/** drawing-area inset so floating controls never sit on top of nodes (prototype). */
const INSET = { top: 72, bottom: 72, left: 30, right: 30 };

type NeighborhoodCache = Record<string, Neighbor[]>;

export function GraphProjectionView({
  result,
  messages,
  spaceId,
  kbData,
  selectedId,
  onSelect,
  refreshKey,
}: ProjectionViewProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  const shortcutPairs = React.useMemo(
    () => (kbData?.shortcuts ?? []).map((s) => ({ from: s.from, to: s.to })),
    [kbData?.shortcuts]
  );
  const tagsByItem = kbData?.tagsByItem ?? {};

  // RLS-backed neighbourhood cache keyed by node id. Populated by the engine port
  // (relates_to ⊕ tagged, dir=both, depth 1). The ego layout reads it for assoc/tag
  // edges; containment/shortcut come from the forests (synchronous).
  const [nbrs, setNbrs] = React.useState<NeighborhoodCache>({});

  // TAG NODES are NOT in the resolved canvas (the default lens-spec filters them to
  // the tag FACET, never to a card — see buildDefaultLensSpec). The graph view DOES
  // need them in its node index: a `tagged` edge whose target tag is absent renders a
  // ghost edge into empty space, the "Tags" overview cluster is empty, and search
  // misses tags (slice-11 Graph bug 1). So the graph view augments the containment
  // index with every tag node it can see — the tags attached to items (`tagsByItem`,
  // id + title) and any tag node returned in a fetched neighbourhood — WITHOUT
  // touching the frozen spec or the lens canvas (tags stay out of the lens cards).
  const containment = React.useMemo(() => {
    const base = buildContainment(result.items, kbData?.containment ?? []);
    const addTag = (id: string, title: string) => {
      if (!base.byId.has(id)) {
        base.byId.set(id, { id, kind: 'tag', title });
      }
    };
    for (const list of Object.values(tagsByItem)) {
      for (const tag of list) {
        addTag(tag.id, tag.title);
      }
    }
    for (const list of Object.values(nbrs)) {
      for (const neighbor of list) {
        if (neighbor.node.kind === 'tag') {
          addTag(neighbor.node.id, neighbor.node.title);
        }
      }
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.items, kbData?.containment, tagsByItem, nbrs]);

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 900, h: 560 });
  const [mode, setMode] = React.useState<'local' | 'global'>('local');
  const [depth, setDepth] = React.useState(2);
  const [trail, setTrail] = React.useState<string[]>([]);
  const [q, setQ] = React.useState('');
  const [view, setView] = React.useState({ scale: 1, tx: 0, ty: 0 });
  const [fTypes, setFTypes] = React.useState<ReadonlySet<string>>(new Set());
  const [fTags, setFTags] = React.useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(
    new Set()
  );

  // Default focus: the shared selection if it is a real node, else the first
  // resolved item (prototype default `d-welcome`; seed ids differ, so we pick the
  // first available node — parity with the Notion view's fallback).
  const focusId = React.useMemo(() => {
    if (selectedId && containment.byId.has(selectedId)) {
      return selectedId;
    }
    return result.items[0]?.id ?? null;
  }, [selectedId, containment, result.items]);

  // Drop the cache when the graph changes (a mutation refetched the canvas).
  React.useEffect(() => {
    setNbrs({});
  }, [refreshKey]);

  const fetchNeighborhood = React.useCallback(
    async (nodeId: string, kind: string) => {
      // content node → related + tags (both); tag → resources tagged-by (incoming).
      const isTag = kind === 'tag';
      const params = new URLSearchParams({
        space_id: spaceId ?? '',
        node_id: nodeId,
        rel: isTag ? 'tagged' : 'relates_to,tagged',
        dir: isTag ? 'incoming' : 'both',
        depth: '1',
      });
      const res = await fetch(`/author/graph/neighborhood?${params}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as NeighborhoodResult;
      setNbrs((prev) => ({ ...prev, [nodeId]: data.neighbors }));
    },
    [spaceId]
  );

  // Adjacency assembled from RLS-backed sources: the port (assoc/tag, lazily
  // fetched + cached) ⊕ the forests (contains/shortcut, synchronous). A node not
  // yet fetched contributes only its containment/shortcut edges until its
  // neighbourhood arrives — the ring fills in as fetches resolve (engine-gap 1).
  const adjacency = React.useCallback(
    (id: string): GraphAdjacency[] =>
      adjacencyOf(id, nbrs[id] ?? [], containment, shortcutPairs),
    [nbrs, containment, shortcutPairs]
  );

  // Facet pass — folders/tags always pass (prototype-parity); else filter by the
  // active kind/tag facets over the RLS-resolved tag map.
  const passes = React.useCallback(
    (n: GraphNode | undefined): boolean => {
      if (!n) {
        return false;
      }
      if (n.kind === 'folder' || n.kind === 'tag') {
        return true;
      }
      if (fTypes.size > 0 && !fTypes.has(n.kind)) {
        return false;
      }
      if (fTags.size > 0) {
        const ids = (tagsByItem[n.id] ?? []).map((tag) => tag.id);
        if (!ids.some((id) => fTags.has(id))) {
          return false;
        }
      }
      return true;
    },
    [fTypes, fTags, tagsByItem]
  );
  const facetOn = fTypes.size > 0 || fTags.size > 0;

  // measure the canvas
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight })
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // path-trail — append the focus when it changes (cap 8, prototype-parity).
  React.useEffect(() => {
    if (!focusId) {
      return;
    }
    setTrail((prev) =>
      prev[prev.length - 1] === focusId
        ? prev
        : [...prev.filter((x) => x !== focusId), focusId].slice(-8)
    );
  }, [focusId]);

  // fetch the focus neighbourhood when it changes (the centre's RLS-backed edges).
  React.useEffect(() => {
    if (!focusId || mode !== 'local' || nbrs[focusId]) {
      return;
    }
    const node = containment.byId.get(focusId);
    if (node) {
      void fetchNeighborhood(focusId, node.kind);
    }
  }, [focusId, mode, nbrs, containment, fetchNeighborhood]);

  // reset zoom/pan when switching mode (prototype-parity).
  React.useEffect(() => {
    setView({ scale: 1, tx: 0, ty: 0 });
  }, [mode]);

  const area = {
    x0: INSET.left,
    y0: INSET.top,
    x1: Math.max(INSET.left + 120, size.w - INSET.right),
    y1: Math.max(INSET.top + 120, size.h - INSET.bottom),
  };
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  const acx = area.x0 + aw / 2;
  const acy = area.y0 + ah / 2;

  // LOCAL radial ego layout (depth rings).
  const ego = React.useMemo(() => {
    if (!focusId) {
      return null;
    }
    const avail = Math.min(aw, ah) * 0.46;
    const ringStep = avail / depth;
    return egoLayout(focusId, depth, acx, acy, ringStep, adjacency, (n) =>
      passes(n)
    );
  }, [focusId, depth, aw, ah, acx, acy, adjacency, passes]);

  // Lazy frontier expansion (engine-gap 1): when the ego tree reaches depth > 1,
  // fetch the depth-1 neighbourhood of each ring node not yet loaded so the next
  // ring can fill — a SEQUENCE of bounded port calls, never one deep fetch.
  React.useEffect(() => {
    if (!ego || mode !== 'local' || depth < 2) {
      return;
    }
    for (const [id, p] of Object.entries(ego.pos)) {
      if (p.level >= 1 && p.level < depth) {
        const node = containment.byId.get(id);
        if (node && node.kind !== 'tag' && !nbrs[id]) {
          void fetchNeighborhood(id, node.kind);
        }
      }
    }
  }, [ego, mode, depth, containment, nbrs, fetchNeighborhood]);

  // edge pairs over the loaded data, for the Overview cross-section weights
  // (RLS-backed: forests + whatever neighbourhoods are cached).
  const overviewEdgePairs = React.useMemo(() => {
    const pairs: { from: string; to: string }[] = [];
    for (const e of kbData?.containment ?? []) {
      pairs.push({ from: e.from, to: e.to });
    }
    for (const s of shortcutPairs) {
      pairs.push(s);
    }
    for (const [id, list] of Object.entries(nbrs)) {
      for (const n of list) {
        if (n.direction !== 'incoming') {
          pairs.push({ from: id, to: n.node.id });
        }
      }
    }
    return pairs;
  }, [kbData?.containment, shortcutPairs, nbrs]);

  // GLOBAL clustered overview (client aggregation over the resolved set).
  const clusters = React.useMemo(() => {
    if (mode !== 'global') {
      return null;
    }
    // The overview clusters the FULL augmented index (content + folders + TAGS) so
    // the "Tags" cluster is populated (bug 1) — `result.items` omits tag nodes.
    const nodes: GraphNode[] = [...containment.byId.values()].map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
    }));
    return clusterLayout(
      nodes,
      containment,
      overviewEdgePairs,
      area,
      (n) => passes(n),
      t('graph.spatial.tagsCluster'),
      t('graph.spatial.otherCluster')
    );
  }, [mode, containment, overviewEdgePairs, area, passes, t]);

  // edges to draw
  const lines = React.useMemo(() => {
    if (mode === 'local' && ego) {
      return ego.edges
        .map((e, i) => {
          const a = ego.pos[e.from];
          const b = ego.pos[e.to];
          return a && b
            ? {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                rel: e.rel,
                key: i,
                w: 0,
              }
            : null;
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
    }
    if (clusters) {
      return clusters.cedges
        .map((e, i) => {
          const a = clusters.pos[e.from];
          const b = clusters.pos[e.to];
          return a && b
            ? {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                rel: 'associative' as GraphRel,
                key: i,
                w: e.w,
              }
            : null;
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
    }
    return [];
  }, [mode, ego, clusters]);

  const localNodeIds = ego ? Object.keys(ego.pos) : [];
  const tags = React.useMemo(() => {
    const byId = new Map<string, { id: string; title: string }>();
    for (const list of Object.values(tagsByItem)) {
      for (const tag of list) {
        byId.set(tag.id, tag);
      }
    }
    return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [tagsByItem]);

  // Search over the FULL augmented node index (content + folders + tags) so tags
  // are jump-to-able too (slice-11 Graph bug 1) — `result.items` alone omits tags.
  const results =
    q.trim().length > 0
      ? [...containment.byId.values()]
          .filter((n) => n.title.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 8)
      : [];

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
  ) => {
    return (value: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      });
  };
  const toggleType = toggleSet(setFTypes);
  const toggleTag = toggleSet(setFTags);
  const toggleExp = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const go = React.useCallback(
    (id: string) => {
      if (containment.byId.has(id)) {
        onSelect(id);
        setQ('');
      }
    },
    [containment, onSelect]
  );

  // ── zoom & pan (prototype-parity) ──────────────────────────────────────
  const zoomAt = (factor: number, mx: number, my: number) =>
    setView((v) => {
      const ns = Math.min(2.6, Math.max(0.4, v.scale * factor));
      const k = ns / v.scale;
      return { scale: ns, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  // Wheel-zoom over the map. Attached as a NON-PASSIVE native listener (below) so
  // `preventDefault` actually stops the page scrolling under the canvas — a React
  // `onWheel` registers passive and the call is a no-op (slice-11 Graph bug 2).
  const zoomAtRef = React.useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAtRef.current(
        e.deltaY < 0 ? 1.12 : 1 / 1.12,
        e.clientX - r.left,
        e.clientY - r.top
      );
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);
  const zoomBtn = (factor: number) => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  };
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 });
  const panStart = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      e.button !== 0 ||
      target.closest('.kb-gnode') ||
      target.closest('button')
    ) {
      return;
    }
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = view.tx;
    const oy = view.ty;
    const move = (ev: MouseEvent) =>
      setView((v) => ({
        ...v,
        tx: ox + (ev.clientX - sx),
        ty: oy + (ev.clientY - sy),
      }));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'grabbing';
  };

  if (!spaceId) {
    return null;
  }

  // Graph has no side panel; its trail + facet controls live across the top, so
  // they fill the shell's toolbar slot — same outer spacing as the other tabs.
  const toolbar = (
    <>
      {/* path-trail */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-[18px] py-2.5">
        <Route
          className="text-muted-foreground size-3.5 shrink-0"
          aria-hidden
        />
        <span className="text-muted-foreground mr-0.5 shrink-0 text-xs">
          {t('graph.spatial.path')}
        </span>
        {trail.length === 0 ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : null}
        {trail.map((id, i) => {
          const n = containment.byId.get(id);
          if (!n) {
            return null;
          }
          const cur = id === focusId;
          const NodeIcon = iconForKind(n.kind);
          return (
            <React.Fragment key={id}>
              {i > 0 ? (
                <ChevronRight
                  className="text-muted-foreground size-3 shrink-0"
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                onClick={() => go(id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-xs',
                  cur
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-foreground'
                )}
              >
                <NodeIcon
                  className={cn(
                    'size-3 shrink-0',
                    cur ? 'text-primary-foreground' : 'text-muted-foreground'
                  )}
                  aria-hidden
                />
                {n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title}
              </button>
            </React.Fragment>
          );
        })}
        {trail.length > 1 && focusId ? (
          <button
            type="button"
            onClick={() => setTrail([focusId])}
            className="text-muted-foreground ml-auto shrink-0 text-xs underline"
          >
            {t('graph.spatial.clearPath')}
          </button>
        ) : null}
      </div>

      {/* facet filter */}
      <div className="bg-muted/40 flex shrink-0 items-center gap-2 overflow-x-auto border-b px-[18px] py-[9px]">
        <Filter
          className="text-muted-foreground size-3.5 shrink-0"
          aria-hidden
        />
        <span className="text-muted-foreground shrink-0 text-xs">
          {t('graph.spatial.filter')}
        </span>
        {(
          [
            { k: 'text', label: kindLabel(t, 'text') },
            { k: 'file', label: kindLabel(t, 'file') },
            { k: 'video', label: kindLabel(t, 'video') },
            { k: 'link', label: kindLabel(t, 'link') },
          ] as const
        ).map((f) => {
          const FIcon = iconForKind(f.k);
          const on = fTypes.has(f.k);
          return (
            <button
              key={f.k}
              type="button"
              onClick={() => toggleType(f.k)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-xs',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-foreground'
              )}
            >
              <FIcon
                className={cn(
                  'size-3 shrink-0',
                  on ? 'text-primary-foreground' : 'text-muted-foreground'
                )}
                aria-hidden
              />
              {f.label}
            </button>
          );
        })}
        {tags.length > 0 ? (
          <span className="bg-border mx-0.5 h-[18px] w-px shrink-0" />
        ) : null}
        {tags.map((tag) => {
          const on = fTags.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggleTag(tag.id)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-xs',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-foreground'
              )}
            >
              {tag.title}
            </button>
          );
        })}
        {facetOn ? (
          <button
            type="button"
            onClick={() => {
              setFTypes(new Set());
              setFTags(new Set());
            }}
            className="text-muted-foreground ml-auto shrink-0 text-xs underline"
          >
            {t('graph.spatial.clearFilter')}
          </button>
        ) : null}
      </div>
    </>
  );

  // The map paints to its own edges (dot grid + floating controls), so the shared
  // main region runs full-bleed; the canvas fills it.
  const main = (
    <div
      ref={wrapRef}
      className="relative size-full overflow-hidden"
      style={{
        backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        backgroundPosition: '-1px -1px',
      }}
    >
      {/* top-left controls: mode + depth */}
      <div className="absolute top-3.5 left-3.5 z-[7] flex flex-wrap items-center gap-2">
        <div className="bg-card flex overflow-hidden rounded-md border shadow-xs">
          <ModeButton
            active={mode === 'local'}
            onClick={() => setMode('local')}
          >
            <LocateFixed className="size-3.5" aria-hidden />
            {t('graph.spatial.focusMode')}
          </ModeButton>
          <ModeButton
            active={mode === 'global'}
            onClick={() => setMode('global')}
          >
            <Globe className="size-3.5" aria-hidden />
            {t('graph.spatial.overviewMode')}
          </ModeButton>
        </div>
        {mode === 'local' ? (
          <div className="bg-card flex items-center gap-1.5 rounded-md border px-2.5 py-[5px] shadow-xs">
            <span className="text-muted-foreground text-xs">
              {t('graph.spatial.depth')}
            </span>
            {[1, 2, 3, 4, 5].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDepth(d)}
                className={cn(
                  'size-[22px] rounded-sm text-xs font-semibold',
                  depth === d
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {d}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* search-to-focus */}
      <div className="absolute top-3.5 right-4 z-[8] w-[230px]">
        <div className="relative">
          <span className="text-muted-foreground absolute top-1/2 left-2.5 inline-flex -translate-y-1/2">
            <Search className="size-3.5" aria-hidden />
          </span>
          <Input
            placeholder={t('graph.spatial.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="bg-card h-[34px] pl-[30px]"
          />
        </div>
        {results.length > 0 ? (
          <div className="bg-card mt-1 max-h-[280px] overflow-hidden overflow-y-auto rounded-md border shadow-lg">
            {results.map((n) => {
              const RIcon = iconForKind(n.kind);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => go(n.id)}
                  className="hover:bg-accent flex w-full items-center gap-2 px-2.5 py-2 text-left"
                >
                  <RIcon
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-sm">{n.title}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* zoom/pan transform layer (edges + nodes) */}
      <div
        onMouseDown={panStart}
        className="absolute inset-0 cursor-grab"
        style={{
          transformOrigin: '0 0',
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      >
        {/* edges */}
        <svg
          className="pointer-events-none absolute inset-0 z-[1] size-full"
          aria-hidden
        >
          {lines.map((l) => {
            const s = EDGE_STYLE[l.rel] ?? EDGE_STYLE.associative;
            return (
              <line
                key={l.key}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke={s.stroke}
                strokeWidth={l.w ? Math.min(1 + l.w * 0.7, 5) : 1.5}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={s.dash}
                opacity={s.opacity}
                style={{ transition: 'all .42s cubic-bezier(.4,0,.2,1)' }}
              />
            );
          })}
        </svg>

        {/* nodes */}
        {mode === 'local' && ego
          ? localNodeIds.map((id) => {
              const p = ego.pos[id];
              const n = containment.byId.get(id);
              if (!n) {
                return null;
              }
              const isFocus = id === focusId;
              const badge =
                !isFocus && p.level === ego.maxLevel
                  ? Math.max(0, adjacency(id).length - 1)
                  : 0;
              return (
                <GraphNodeButton
                  key={id}
                  x={p.x}
                  y={p.y}
                  node={n}
                  focus={isFocus}
                  level={p.level}
                  badge={badge}
                  zoom={view.scale}
                  onClick={() => !isFocus && go(id)}
                />
              );
            })
          : clusters
            ? clusters.list.map((c) => {
                const p = clusters.pos[c.id];
                if (!p) {
                  return null;
                }
                if (expanded.has(c.id)) {
                  const r = Math.min(132, 48 + c.count * 9);
                  return (
                    <React.Fragment key={c.id}>
                      {c.members.map((m, i) => {
                        const a = -Math.PI / 2 + (i / c.count) * Math.PI * 2;
                        return (
                          <GraphNodeButton
                            key={m.id}
                            x={p.x + Math.cos(a) * r}
                            y={p.y + Math.sin(a) * r}
                            node={m}
                            level={1}
                            zoom={view.scale}
                            onClick={() => {
                              go(m.id);
                              setMode('local');
                            }}
                          />
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => toggleExp(c.id)}
                        title={c.label}
                        className="border-primary bg-primary text-primary-foreground absolute z-[6] inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs font-semibold whitespace-nowrap shadow-md"
                        style={{
                          left: p.x,
                          top: p.y,
                          transform: `translate(-50%, -50%) scale(${1 / view.scale})`,
                        }}
                      >
                        <ClusterIcon
                          isTags={c.isTags}
                          className="text-primary-foreground size-3"
                        />
                        {c.label}
                        <Minimize2
                          className="text-primary-foreground size-3"
                          aria-hidden
                        />
                      </button>
                    </React.Fragment>
                  );
                }
                return (
                  <ClusterNodeButton
                    key={c.id}
                    x={p.x}
                    y={p.y}
                    cluster={c}
                    zoom={view.scale}
                    onClick={() => toggleExp(c.id)}
                  />
                );
              })
            : null}
      </div>

      {/* zoom controls */}
      <div className="bg-card absolute top-1/2 right-4 z-[7] flex -translate-y-1/2 flex-col overflow-hidden rounded-md border shadow-sm">
        <button
          type="button"
          onClick={() => zoomBtn(1.2)}
          title={t('graph.spatial.zoomIn')}
          className="text-foreground grid h-8 w-[34px] place-items-center"
        >
          <Plus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={resetView}
          title={t('graph.spatial.resetZoom')}
          className="text-foreground grid h-8 w-[34px] place-items-center border-y text-[9px] font-semibold"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBtn(1 / 1.2)}
          title={t('graph.spatial.zoomOut')}
          className="text-foreground grid h-8 w-[34px] place-items-center"
        >
          <Minus className="size-4" aria-hidden />
        </button>
      </div>

      {/* legend */}
      <div className="bg-card text-muted-foreground absolute bottom-3.5 left-3.5 z-[6] flex gap-3.5 rounded-md border px-3 py-2 text-[11px] shadow-xs">
        {(['associative', 'contains', 'tagged'] as const).map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="22"
                y2="3"
                stroke={EDGE_STYLE[r].stroke}
                strokeWidth="1.5"
                strokeDasharray={EDGE_STYLE[r].dash}
                opacity={EDGE_STYLE[r].opacity}
              />
            </svg>
            {legendLabel(t, r)}
          </span>
        ))}
      </div>

      {/* depth / overview hint */}
      <div className="text-muted-foreground absolute right-4 bottom-3.5 z-[6] max-w-[250px] text-right text-[11px] leading-normal">
        {mode === 'local'
          ? t('graph.spatial.hintLocal', {
              depth,
              count: localNodeIds.length,
            })
          : t('graph.spatial.hintGlobal')}
      </div>
    </div>
  );

  return <WorkbenchShell toolbar={toolbar} main={main} bleed />;
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-[7px] text-sm font-medium',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
      )}
    >
      {children}
    </button>
  );
}

/** A graph node — exact prototype `GNode` sizing/opacity/radius/shadow. */
function GraphNodeButton({
  x,
  y,
  node,
  focus = false,
  level = 0,
  badge = 0,
  zoom,
  onClick,
}: {
  x: number;
  y: number;
  node: GraphNode;
  focus?: boolean;
  level?: number;
  badge?: number;
  zoom: number;
  onClick: () => void;
}) {
  const isTag = node.kind === 'tag';
  const NodeIcon = iconForKind(node.kind);
  const sz = focus ? 56 : isTag ? 28 : level >= 2 ? 36 : 44;
  const iconSize = focus ? 22 : isTag ? 13 : level >= 2 ? 15 : 18;
  return (
    <button
      type="button"
      onClick={onClick}
      title={node.title}
      className={cn(
        'kb-gnode absolute flex w-24 flex-col items-center gap-1 border-none bg-transparent',
        focus ? 'z-[5]' : 'z-[3] cursor-pointer'
      )}
      style={{
        left: x,
        top: y,
        // Counter-scale by 1/zoom so the node GLYPH keeps a constant on-screen size
        // while zoom only spreads POSITIONS — a bad initial scale no longer persists
        // when zooming the focus. Nodes are fully opaque (the opaque disc hides the
        // edge endpoint that previously showed through dimmed/translucent leaves).
        transform: `translate(-50%, -50%) scale(${1 / zoom})`,
        transition:
          'left .42s cubic-bezier(.4,0,.2,1), top .42s cubic-bezier(.4,0,.2,1)',
      }}
    >
      <span
        className={cn(
          'relative grid place-items-center border',
          isTag ? 'rounded-full' : 'rounded-lg',
          focus
            ? 'bg-primary border-primary shadow-lg'
            : 'bg-card border-border shadow-sm'
        )}
        style={{
          width: sz,
          height: sz,
          boxSizing: 'border-box',
          transition: 'width .3s, height .3s, background .2s',
        }}
      >
        <NodeIcon
          className={
            focus ? 'text-primary-foreground' : 'text-muted-foreground'
          }
          style={{ width: iconSize, height: iconSize }}
          aria-hidden
        />
        {badge > 0 ? (
          <span className="bg-foreground text-background border-background absolute -top-[9px] -right-[10px] flex h-[15px] min-w-4 items-center justify-center rounded-lg border-2 px-1 text-[10px] leading-none font-bold">
            +{badge}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'text-foreground max-w-24 truncate rounded px-[3px] text-center text-[11px] leading-tight',
          focus ? 'font-semibold' : 'font-medium'
        )}
        style={{
          background: 'color-mix(in oklab, var(--background) 72%, transparent)',
        }}
      >
        {node.title}
      </span>
    </button>
  );
}

/** A collapsed cluster bubble — exact prototype `ClusterNode` sizing. */
function ClusterNodeButton({
  x,
  y,
  cluster,
  zoom,
  onClick,
}: {
  x: number;
  y: number;
  cluster: GraphCluster;
  zoom: number;
  onClick: () => void;
}) {
  const sz = Math.min(98, 54 + cluster.count * 4);
  return (
    <button
      type="button"
      onClick={onClick}
      title={cluster.label}
      className="kb-gnode absolute z-[3] flex w-[124px] flex-col items-center gap-1.5 border-none bg-transparent"
      style={{
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${1 / zoom})`,
        transition:
          'left .42s cubic-bezier(.4,0,.2,1), top .42s cubic-bezier(.4,0,.2,1)',
      }}
    >
      <span
        className="bg-card border-border relative grid place-items-center rounded-xl border-[1.5px] shadow-md"
        style={{ width: sz, height: sz, boxSizing: 'border-box' }}
      >
        <ClusterIcon
          isTags={cluster.isTags}
          className="text-foreground"
          style={{
            width: Math.round(sz * 0.32),
            height: Math.round(sz * 0.32),
          }}
        />
        <span className="bg-primary text-primary-foreground border-background absolute -top-2 -right-2 grid h-[22px] min-w-[22px] place-items-center rounded-[11px] border-2 px-1.5 text-[11px] font-bold">
          {cluster.count}
        </span>
      </span>
      <span className="text-foreground max-w-[124px] text-center text-xs leading-tight font-semibold">
        {cluster.label}
      </span>
    </button>
  );
}

/** Cluster icon: a tag-cluster uses the tag icon, else the folder icon. */
function ClusterIcon({
  isTags,
  className,
  style,
}: {
  isTags: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = iconForKind(isTags ? 'tag' : 'folder');
  return <Icon className={className} style={style} aria-hidden />;
}

/** Legend label via LITERAL keys (i18n rule — no dynamic-key indirection). */
function legendLabel(t: GraphTranslator, rel: GraphRel): string {
  switch (rel) {
    case 'associative':
      return t('graph.spatial.legendRelated');
    case 'contains':
      return t('graph.spatial.legendContains');
    case 'tagged':
      return t('graph.spatial.legendTagged');
    case 'shortcut':
      return t('graph.spatial.legendShortcut');
  }
}
