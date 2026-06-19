'use client';

import type { NeighborhoodResult } from '@workspace/knowledge-contracts';
import { EmptyState } from '@workspace/ui/components/empty-state';

/**
 * ResourceMiniGraph — a thin SVG over a depth-1 `NeighborhoodResult`: the center
 * node in the middle, its neighbors arranged on a circle, an edge to each. A
 * `tagged` edge is dashed to distinguish it from associative `relates_to`. Purely
 * presentational — the data is one `resolveNeighborhood` call; this draws it.
 *
 * Strictly semantic-token styling: every stroke/fill is `currentColor` or a
 * token-driven class via the parent's text color (no hardcoded hex/oklch).
 */

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 78;

export type ResourceMiniGraphProps = {
  centerTitle: string;
  neighborhood: NeighborhoodResult;
  emptyLabel: string;
};

export function ResourceMiniGraph({
  centerTitle,
  neighborhood,
  emptyLabel,
}: ResourceMiniGraphProps) {
  const neighbors = neighborhood.neighbors;

  if (neighbors.length === 0) {
    return <EmptyState compact>{emptyLabel}</EmptyState>;
  }

  const points = neighbors.map((neighbor, index) => {
    const angle = (index / neighbors.length) * Math.PI * 2 - Math.PI / 2;
    return {
      neighbor,
      x: CENTER + Math.cos(angle) * RADIUS,
      y: CENTER + Math.sin(angle) * RADIUS,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={centerTitle}
      className="text-muted-foreground h-auto w-full"
    >
      <g stroke="currentColor" fill="none" strokeWidth={1.5}>
        {points.map(({ neighbor, x, y }) => (
          <line
            key={neighbor.edge_id}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            strokeDasharray={
              neighbor.relation_type === 'tagged' ? '4 3' : undefined
            }
            opacity={0.5}
          />
        ))}
      </g>
      {points.map(({ neighbor, x, y }) => (
        <circle
          key={`node-${neighbor.node.id}`}
          cx={x}
          cy={y}
          r={6}
          fill="currentColor"
          opacity={0.65}
        />
      ))}
      <circle cx={CENTER} cy={CENTER} r={9} className="fill-primary" />
    </svg>
  );
}
