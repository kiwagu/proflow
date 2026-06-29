'use client';

import { RenderLexical } from '@payloadcms/richtext-lexical/client';
import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical';
import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { ArrowLeft, Check, Send } from 'lucide-react';
import * as React from 'react';

import { EditableDocumentTitle } from '@/app/graph/views/document-reader/document-title';
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

  // The document title is the NODE title (outside the Lexical body) — editable inline at the
  // top of the editor (WYSIWYG with the read view) and persisted via the existing rename
  // route (`PATCH /author/graph/resources`, `space.knowledge.update`, RLS). The last SAVED
  // title rides in a ref so a re-blur with no change never re-PATCHes; empty/failed commits
  // revert to it.
  const [titleValue, setTitleValue] = React.useState(title);
  const savedTitleRef = React.useRef(title);
  const revertTitle = React.useCallback(
    () => setTitleValue(savedTitleRef.current),
    []
  );
  const commitTitle = React.useCallback(async () => {
    const next = titleValue.trim();
    if (!next || next === savedTitleRef.current) {
      setTitleValue(savedTitleRef.current);
      return;
    }
    const res = await fetch('/author/graph/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId, resourceId: nodeId, title: next }),
    });
    if (res.ok) {
      savedTitleRef.current = next;
    } else {
      setTitleValue(savedTitleRef.current);
    }
  }, [titleValue, spaceId, nodeId]);

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
          {/* The document title leads the editor content — SAME serif heading the read view
              shows (WYSIWYG, no read↔edit drift), but EDITABLE here. `pl-[10rem]` aligns it
              with the Lexical content column (which is inset by the editor's block gutter /
              per-line DnD affordances). */}
          <EditableDocumentTitle
            value={titleValue}
            onChange={setTitleValue}
            onCommit={commitTitle}
            onRevert={revertTitle}
            className="pl-[3rem]"
          />
          <RenderLexical
            // `label: false` drops the redundant "Body" field label — the editor
            // pane is obviously the document body.
            field={{ name: 'body', label: false }}
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
