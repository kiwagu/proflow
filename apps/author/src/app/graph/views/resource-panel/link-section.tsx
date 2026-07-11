import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { linkUrlSchema } from '@workspace/knowledge-contracts';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';
import { Check, ExternalLink, Link2, Pencil } from 'lucide-react';
import * as React from 'react';

import type { KbAttributes } from '@/app/graph/graph-data.types';

import { PanelSectionLabel } from './panel-section-label';

/**
 * LinkSection — the external URL of a `kind=link` node (slice-10 §2.4), the
 * EditableDescription mold applied to the `link` satellite: shown for EVERY link
 * node (not only ones with a satellite) so a bare pre-slice link can still be
 * given its URL. Display = the URL + "Open" (a plain anchor — the target is an
 * EXTERNAL site, nothing to server-authorize, unlike the media Download); edit =
 * an Input saved through the same attributes-route UPSERT. The client validates
 * http(s)-only for an instant hint; the route's zod + the DB CHECK are the fence.
 */
export function LinkSection({
  t,
  link,
  nodeId,
  disabled,
  onSave,
}: {
  t: ReturnType<typeof createGraphTranslator>;
  link: KbAttributes['link'] | null;
  nodeId: string;
  disabled: boolean;
  onSave: (url: string) => void;
}) {
  const url = link?.url ?? '';
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(url);

  // A new node, or a fresh server `url` (after a save), discards the local draft
  // and exits edit mode — adjusted during render on the change ("you might not
  // need an effect"), not in an effect. Compound key → shallow-equal comparator.
  const changed = useValueChanged(
    { url, nodeId },
    (a, b) => a.url === b.url && a.nodeId === b.nodeId
  );
  if (changed) {
    setDraft(url);
    setEditing(false);
  }

  const draftValid = linkUrlSchema.safeParse(draft).success;

  function save() {
    if (!draftValid) {
      return;
    }
    onSave(draft.trim());
    setEditing(false);
  }

  return (
    <section className="flex flex-col gap-2">
      <PanelSectionLabel>
        <Link2 className="size-3" aria-hidden />
        {t('graph.link.section')}
      </PanelSectionLabel>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Input
            autoFocus
            type="url"
            inputMode="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft(url);
                setEditing(false);
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                save();
              }
            }}
            placeholder={t('graph.link.urlPlaceholder')}
            disabled={disabled}
          />
          {draft.trim().length > 0 && !draftValid ? (
            <p role="alert" className="text-destructive text-xs">
              {t('graph.link.invalidUrl')}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={disabled || !draftValid}>
              <Check className="size-4" aria-hidden />
              {t('graph.panel.save')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDraft(url);
                setEditing(false);
              }}
              disabled={disabled}
            >
              {t('graph.panel.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={() => setEditing(true)}
            className="hover:border-ring hover:bg-accent h-auto w-full items-start justify-start gap-2 border-dashed p-2.5 text-left font-normal shadow-none"
          >
            <span className="text-muted-foreground flex-1 break-all whitespace-normal">
              {url || t('graph.link.empty')}
            </span>
            <Pencil
              className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
              aria-hidden
            />
          </Button>
          {url ? (
            <div>
              {/* A plain anchor: the URL was stored through the http(s)-only fence,
                  so it is safe as an href; noopener/noreferrer severs the opener. */}
              <Button size="sm" variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" aria-hidden />
                  {t('graph.link.open')}
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
