'use client';

import type { NeighborhoodResult } from '@workspace/knowledge-contracts';
import { EmptyState } from '@workspace/ui/components/empty-state';

/**
 * ResourceMiniGraph — a thin SVG over a depth-1 `NeighborhoodResult` (prototype
 * MiniGraph): the center node in the middle with a bold label, its neighbors on a
 * circle each with a truncated label + an edge. A `tagged` edge is dashed and tag
 * nodes are smaller/muted; `relates_to` edges read stronger. Purely presentational
 * — the data is one `resolveNeighborhood` call; this draws it.
 *
 * Strictly semantic-token styling: every stroke/fill is a token utility
 * (`stroke-border`, `fill-primary`, `fill-foreground`, …) — no hardcoded hex/oklch,
 * dark mode automatic.
 */

const WIDTH = 300;
const HEIGHT = 190;
const CX = WIDTH / 2;
const CY = 82;
const RADIUS = 64;
/** The mini-graph is a preview; the full set is one click away via "View in graph". */
const MAX_NEIGHBORS = 6;

function truncate(title: string, max = 16): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

export type ResourceMiniGraphProps = {
  centerTitle: string;
  neighborhood: NeighborhoodResult;
  emptyLabel: string;
  /** Click a NON-tag neighbor node → open it (prototype MiniGraph `onOpen`). */
  onNeighborClick?: (nodeId: string) => void;
};

export function ResourceMiniGraph({
  centerTitle,
  neighborhood,
  emptyLabel,
  onNeighborClick,
}: ResourceMiniGraphProps) {
  const neighbors = neighborhood.neighbors.slice(0, MAX_NEIGHBORS);

  if (neighbors.length === 0) {
    return <EmptyState compact>{emptyLabel}</EmptyState>;
  }

  const points = neighbors.map((neighbor, index) => {
    const angle = (index / neighbors.length) * Math.PI * 2 - Math.PI / 2;
    return {
      neighbor,
      x: CX + Math.cos(angle) * RADIUS,
      y: CY + Math.sin(angle) * RADIUS,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={centerTitle}
      className="h-auto w-full"
    >
      {/* edges */}
      {points.map(({ neighbor, x, y }) => (
        <line
          key={neighbor.edge_id}
          x1={CX}
          y1={CY}
          x2={x}
          y2={y}
          strokeWidth={1.5}
          className={
            neighbor.relation_type === 'relates_to'
              ? 'stroke-foreground'
              : 'stroke-border'
          }
          strokeDasharray={
            neighbor.relation_type === 'tagged' ? '3 3' : undefined
          }
          opacity={neighbor.relation_type === 'relates_to' ? 0.6 : 0.85}
        />
      ))}

      {/* neighbor nodes + labels — a non-tag node is clickable (opens it). */}
      {points.map(({ neighbor, x, y }) => {
        const isTag = neighbor.node.kind === 'tag';
        const below = y > CY;
        const clickable = !isTag && onNeighborClick;
        return (
          <g
            key={`node-${neighbor.node.id}`}
            role={clickable ? 'button' : undefined}
            aria-label={clickable ? neighbor.node.title : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={
              clickable
                ? (event) => {
                    event.stopPropagation();
                    onNeighborClick(neighbor.node.id);
                  }
                : undefined
            }
            onKeyDown={
              clickable
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onNeighborClick(neighbor.node.id);
                    }
                  }
                : undefined
            }
            className={clickable ? 'cursor-pointer outline-none' : undefined}
          >
            <circle
              cx={x}
              cy={y}
              r={isTag ? 5 : 7}
              strokeWidth={1.5}
              className={
                isTag
                  ? 'fill-muted stroke-border'
                  : 'fill-background stroke-border'
              }
            />
            <text
              x={x}
              y={below ? y + 17 : y - 11}
              textAnchor="middle"
              fontSize={9}
              className="fill-muted-foreground"
            >
              {truncate(neighbor.node.title)}
            </text>
          </g>
        );
      })}

      {/* center node + bold label */}
      <circle cx={CX} cy={CY} r={10} className="fill-primary" />
      <text
        x={CX}
        y={CY + 24}
        textAnchor="middle"
        fontSize={10}
        className="fill-foreground font-semibold"
      >
        {truncate(centerTitle, 18)}
      </text>
    </svg>
  );
}
