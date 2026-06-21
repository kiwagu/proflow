'use client';

import { RenderLexical } from '@payloadcms/richtext-lexical/client';
import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { ArrowLeft, Check, Send } from 'lucide-react';
import * as React from 'react';

import { WorkbenchChrome } from '@/app/graph/workbench-chrome';
import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';

/**
 * DocEditorClient — mounts Payload's FULL Lexical editor for `bodies.body` via
 * `RenderLexical` (rendered through the route group's `RootLayout` server-function
 * environment), so the editor has every admin feature (slash `/`, drag handles,
 * `+` insert, all blocks) WITHOUT the admin chrome. The value is controlled here;
 * Save draft / Publish go through the RLS-gated PATCH route (Payload `update` →
 * versioned), then navigate back to the reader.
 */

type DocEditorClientProps = {
  spaceId: string;
  nodeId: string;
  title: string;
  initialBody: unknown | null;
  initialStatus: string | null;
  messages: Record<string, string>;
};

export function DocEditorClient({
  spaceId,
  nodeId,
  title,
  initialBody,
  messages,
}: DocEditorClientProps) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);
  const [value, setValue] = React.useState<DefaultTypedEditorState | undefined>(
    (initialBody as DefaultTypedEditorState | null) ?? undefined
  );
  const [saving, setSaving] = React.useState(false);

  // RenderLexical's `setValue` is `(val: unknown, …) => void`; adapt the setter.
  const handleSetValue = React.useCallback(
    (next: unknown) =>
      setValue((next as DefaultTypedEditorState | null) ?? undefined),
    []
  );

  // Return to wherever we came from (the reader, with its `?folder=…&doc=…` URL
  // intact) via real history-back, so the browser-back chain stays clean:
  // editor → reader → folder → Drive root. (Navigating forward to `?doc=…` instead
  // would drop the folder and trap back-navigation in an editor↔reader loop.)
  // A cold deep-link with no in-app history falls back to the workbench root.
  const goBack = React.useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign(`${AUTHOR_BASE_PATH}/graph`);
    }
  }, []);

  async function save(status: 'draft' | 'published') {
    setSaving(true);
    try {
      const res = await fetch('/author/graph/text-resources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId, nodeId, body: value, status }),
      });
      if (res.ok) {
        goBack();
        return;
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col">
      <WorkbenchChrome messages={messages} />

      <header className="flex items-center gap-2 border-b px-5 py-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={goBack}>
          <ArrowLeft className="size-4" aria-hidden />
          {t('graph.reader.back')}
        </Button>
        <span className="ml-2 truncate text-sm font-semibold">{title}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={saving}
            onClick={() => void save('draft')}
          >
            <Check className="size-4" aria-hidden />
            {t('graph.reader.saveDraft')}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={saving}
            onClick={() => void save('published')}
          >
            <Send className="size-4" aria-hidden />
            {t('graph.reader.publish')}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 py-8">
          <RenderLexical
            field={{ name: 'body' }}
            schemaPath="collection.bodies.body"
            value={value}
            setValue={handleSetValue}
            initialValue={value}
          />
        </div>
      </main>
    </div>
  );
}
