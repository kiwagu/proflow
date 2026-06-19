'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { Plus } from 'lucide-react';
import * as React from 'react';

/**
 * NodePicker — pick a node to link via `relates_to` (slice-09 §3.6). It reads the
 * RLS-scoped node listing from the landed `resources` GET route (the client never
 * queries Supabase), filters client-side by a typed query, excludes the current
 * node + already-linked targets, and emits the chosen node. The actual edge write
 * is the parent's POST to the edges route — this is selection only.
 */

export type PickableNode = {
  id: string;
  title: string;
  kind: string;
};

export type NodePickerProps = {
  spaceId: string;
  t: GraphTranslator;
  excludeIds: string[];
  disabled?: boolean;
  onPick: (node: PickableNode) => void;
};

export function NodePicker({
  spaceId,
  t,
  excludeIds,
  disabled,
  onPick,
}: NodePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [nodes, setNodes] = React.useState<PickableNode[]>([]);

  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ space_id: spaceId });
    fetch(`/author/graph/resources?${params}`, {
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : { resources: [] }))
      .then((data: { resources: PickableNode[] }) => {
        if (!cancelled) {
          setNodes(data.resources ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  const matches = nodes
    .filter((n) => !excluded.has(n.id))
    .filter((n) =>
      query.trim() === ''
        ? true
        : n.title.toLowerCase().includes(query.trim().toLowerCase())
    )
    .slice(0, 8);

  if (!open) {
    return (
      <Button
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3" aria-hidden />
        {t('graph.panel.addLink')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('graph.panel.searchNodes')}
        disabled={disabled}
        className="h-8"
      />
      <ul className="border-border flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border p-1">
        {matches.map((match) => (
          <li key={match.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onPick(match);
                setOpen(false);
                setQuery('');
              }}
              className="hover:bg-accent w-full truncate rounded-sm px-2 py-1 text-left text-sm transition-colors"
            >
              {match.title}
            </button>
          </li>
        ))}
        {matches.length === 0 ? (
          <li className="text-muted-foreground px-2 py-1 text-xs">
            {t('graph.panel.noMatches')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
