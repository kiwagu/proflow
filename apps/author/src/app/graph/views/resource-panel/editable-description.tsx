import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { Textarea } from '@workspace/ui/components/textarea';
import { useValueChanged } from '@workspace/ui/hooks/use-value-changed';
import { AlignLeft, Check, Pencil } from 'lucide-react';
import * as React from 'react';

import { PanelSectionLabel } from './panel-section-label';

/**
 * Editable description (stored). Saved on Save / ⌘↵. The description body is indexed
 * for LEXICAL search only (trgm over `kb.resource_description.body`) — there is no
 * semantic/vector pipeline, so the copy makes no "found by meaning" claim and no
 * embed/reindex status is shown (poc-no-fallbacks; the prototype's mocked embed badge
 * is intentionally dropped).
 */
export function EditableDescription({
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

  // A new node, or a fresh server `value` (after a save), discards the local draft
  // and exits edit mode — adjusted during render on the change ("you might not need
  // an effect"), not in an effect. Compound key → shallow-equal comparator.
  const changed = useValueChanged(
    { value, nodeId },
    (a, b) => a.value === b.value && a.nodeId === b.nodeId
  );
  if (changed) {
    setDraft(value);
    setEditing(false);
  }

  return (
    <section className="flex flex-col gap-2">
      <PanelSectionLabel>
        <AlignLeft className="size-3" aria-hidden />
        {t('graph.panel.description')}
      </PanelSectionLabel>
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
