import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Badge } from '@workspace/ui/components/badge';
import { Button } from '@workspace/ui/components/button';
import { Hint } from '@workspace/ui/components/hint';
import { Input } from '@workspace/ui/components/input';
import { ToggleChip } from '@workspace/ui/components/toggle-chip';
import { Check, Plus, Tag as TagIcon, X } from 'lucide-react';
import * as React from 'react';

import type { ResourceTag } from '@/app/graph/graph-data.types';

import { PanelSectionLabel } from './panel-section-label';
import { sendJson } from './panel-fetch';

/**
 * TagsSection — the ResourcePanel tag editor (ADR-0003 Variant B). A tag is an
 * ORDINARY node and "R is tagged T" a directed `tagged` edge (from=R → to=T), so
 * every affordance here is an edge write to the landed `/author/graph/edges` route,
 * NEVER a scalar field:
 *   - the node's current tags as REMOVABLE chips (✕ → untag = a `tagged` triple
 *     DELETE);
 *   - a free-text adder (a title → POST `action:'tag'` with `tagTitle`; the route
 *     resolves-or-creates the tag node then links it — two-step tag-on-tagging);
 *   - a "pick from existing tags" TRAY toggling the whole space's tag vocabulary
 *     (`spaceTags`) on/off the node by tag id (POST `action:'tag'` with `tagId` /
 *     untag DELETE) — space-global by construction (a tag rides the same RLS row
 *     policy as any node; there is no separate tag-visibility model).
 *
 * A folder or tag node cannot BE tagged (editable = neither), so those render their
 * tags READ-ONLY (no add UI). Self-contained like the AccessSection: it owns its own
 * `busy` + fetches and calls `onMutated` on success (the workbench re-resolves and
 * the panel refetches). RLS is the sole write authority — a reader's POST fails
 * cleanly (422) and the graph is unchanged.
 */
export function TagsSection({
  t,
  spaceId,
  nodeId,
  nodeKind,
  tags,
  spaceTags,
  onMutated,
}: {
  t: GraphTranslator;
  spaceId: string;
  nodeId: string;
  nodeKind: string;
  /** The node's CURRENT tags (from `kbData.tagsByItem`), pre-sorted by title. */
  tags: ResourceTag[];
  /** ALL tags of the space (from `kbData.spaceTags`) — the tray vocabulary. */
  spaceTags: ResourceTag[];
  onMutated: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  // Folder / tag nodes cannot themselves be tagged (a tag on a tag / folder is not a
  // modelled affordance) — they show their tags read-only, with no add UI.
  const editable = nodeKind !== 'folder' && nodeKind !== 'tag';
  const currentTagIds = React.useMemo(
    () => new Set(tags.map((tag) => tag.id)),
    [tags]
  );

  async function run(ok: Promise<boolean>) {
    setBusy(true);
    const success = await ok;
    setBusy(false);
    if (success) {
      onMutated();
    }
  }

  // Add by free-text title — resolve-or-create the tag node, then link it (the
  // route's two-step tag-on-tagging). An empty/whitespace title never reaches here.
  function addByTitle(tagTitle: string) {
    void run(
      sendJson('/author/graph/edges', {
        action: 'tag',
        spaceId,
        resourceId: nodeId,
        tagTitle,
      })
    );
  }

  // Untag — remove the `tagged` edge by its natural (from,to,relation) key the UI
  // already holds (no round-trip to discover the edge id).
  function untag(tagId: string) {
    void run(
      sendJson(
        '/author/graph/edges',
        { spaceId, fromId: nodeId, toId: tagId, relationType: 'tagged' },
        'DELETE'
      )
    );
  }

  // Tray toggle of an EXISTING space tag — link by tag id (resolve-or-link, no new
  // node) when off, untag via the natural-key DELETE when already on.
  function toggleExisting(tagId: string, isOn: boolean) {
    void run(
      isOn
        ? sendJson(
            '/author/graph/edges',
            { spaceId, fromId: nodeId, toId: tagId, relationType: 'tagged' },
            'DELETE'
          )
        : sendJson('/author/graph/edges', {
            action: 'tag',
            spaceId,
            resourceId: nodeId,
            tagId,
          })
    );
  }

  // READ-ONLY badges for a folder / tag node — omit the whole section when it has no
  // tags (nothing to show, and no add UI on these kinds).
  if (!editable) {
    if (tags.length === 0) {
      return null;
    }
    return (
      <section className="flex flex-col gap-2">
        <PanelSectionLabel>
          <TagIcon className="size-3" aria-hidden />
          {t('graph.panel.tags')}
        </PanelSectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag.id} variant="outline" className="gap-1">
              <TagIcon className="size-3" aria-hidden />
              {tag.title}
            </Badge>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <PanelSectionLabel>
        <TagIcon className="size-3" aria-hidden />
        {t('graph.panel.tags')}
      </PanelSectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag.id}
            className="border-border bg-muted/50 inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs"
          >
            <TagIcon className="size-3" aria-hidden />
            {tag.title}
            <Hint label={t('graph.panel.removeTag')}>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                onClick={() => untag(tag.id)}
                aria-label={t('graph.panel.removeTag')}
                className="size-4 rounded-full p-0"
              >
                <X className="size-3" aria-hidden />
              </Button>
            </Hint>
          </span>
        ))}
        {tags.length === 0 ? (
          <span className="text-muted-foreground text-xs">
            {t('graph.panel.noTags')}
          </span>
        ) : null}
      </div>
      <TagAdder t={t} disabled={busy} onAdd={addByTitle} />
      <TagTray
        t={t}
        allTags={spaceTags}
        currentTagIds={currentTagIds}
        onToggle={toggleExisting}
      />
    </section>
  );
}

/**
 * TagAdder — a tiny inline free-text adder: a title → the two-step tag create + edge
 * (POST `action:'tag'` with `tagTitle`). Enter or the + button submits; an empty
 * title is inert.
 */
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
  function submit() {
    const title = value.trim();
    if (title.length === 0) {
      return;
    }
    onAdd(title);
    setValue('');
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={t('graph.panel.addTag')}
        disabled={disabled}
        className="h-8"
      />
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        disabled={disabled || value.trim().length === 0}
        onClick={submit}
        aria-label={t('graph.panel.addTag')}
      >
        <Plus className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

/**
 * TagTray — the "pick from existing tags" tray: a collapsible row of the whole
 * space's tag vocabulary, each a `ToggleChip` toggling the tag on/off the open node
 * (an active tag shows pressed + a check). Toggling links/unlinks a `tagged` edge via
 * the edges route. Hidden when the space has no tags.
 */
function TagTray({
  t,
  allTags,
  currentTagIds,
  onToggle,
}: {
  t: GraphTranslator;
  allTags: ResourceTag[];
  currentTagIds: ReadonlySet<string>;
  onToggle: (tagId: string, isOn: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (allTags.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-pressed={open}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs"
      >
        <Plus className="size-3" aria-hidden />
        {t('graph.panel.pickTags')}
      </button>
      {open ? (
        <div className="bg-background flex flex-wrap gap-1.5 rounded-lg border p-2">
          {allTags.map((tag) => {
            const on = currentTagIds.has(tag.id);
            return (
              <ToggleChip
                key={tag.id}
                label={tag.title}
                pressed={on}
                onPressedChange={() => onToggle(tag.id, on)}
                icon={on ? Check : undefined}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
