'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import * as React from 'react';

import { AUTHOR_BASE_PATH } from '@/lib/author-base-path';

import {
  ChooseEditSourceDialog,
  type DraftVersion,
  type EditSource,
} from './choose-edit-source';

/**
 * useEditLauncher — the ONE entry point for "edit this text document", shared by
 * the reader's Edit button and the `⋯` context menus (cards + Details panel) so
 * the experience is identical wherever it starts. Read mode shows the PUBLISHED
 * version, so editing must be a deliberate choice when a divergent draft exists:
 *
 *  - no published version (only drafts / brand-new) → open the latest draft,
 *  - published is the latest (no newer drafts)      → new draft from published,
 *  - published + newer draft(s)                     → ask via the chooser.
 *
 * It derives that purely from the version list, then hard-navigates to the editor
 * route with the seed (`?source=published` / `?version=<id>` / none). Render the
 * returned `chooser` once at the host; call `requestEdit(nodeId)` from any trigger.
 */
export function useEditLauncher({
  spaceId,
  messages,
}: {
  spaceId: string;
  messages: Record<string, string>;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);
  const [open, setOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState<DraftVersion[]>([]);
  const [preparing, setPreparing] = React.useState(false);
  const targetNode = React.useRef<string | null>(null);

  const navigate = React.useCallback((nodeId: string, source?: EditSource) => {
    const base = `${AUTHOR_BASE_PATH}/doc/${encodeURIComponent(nodeId)}`;
    const url = !source
      ? base
      : source === 'published'
        ? `${base}?source=published`
        : `${base}?version=${encodeURIComponent(source)}`;
    window.location.assign(url);
  }, []);

  const requestEdit = React.useCallback(
    async (nodeId: string) => {
      setPreparing(true);
      try {
        const res = await fetch(
          `/author/graph/text-resources/versions?node_id=${encodeURIComponent(
            nodeId
          )}&space_id=${encodeURIComponent(spaceId)}`
        );
        const versions = res.ok
          ? (
              (await res.json()) as {
                versions: {
                  id: string;
                  status: string | null;
                  updatedAt: string;
                }[];
              }
            ).versions
          : [];

        // No published version yet → just continue the latest draft.
        if (!versions.some((v) => v.status === 'published')) {
          navigate(nodeId);
          return;
        }
        // Drafts NEWER than the latest published (newest-first list → take the
        // leading drafts, stop at the first published).
        const leadingDrafts: DraftVersion[] = [];
        for (const v of versions) {
          if (v.status === 'published') {
            break;
          }
          if (v.status === 'draft') {
            leadingDrafts.push({ id: v.id, updatedAt: v.updatedAt });
          }
        }
        if (leadingDrafts.length === 0) {
          navigate(nodeId, 'published');
          return;
        }
        targetNode.current = nodeId;
        setDrafts(leadingDrafts);
        setOpen(true);
      } finally {
        setPreparing(false);
      }
    },
    [spaceId, navigate]
  );

  const chooser = (
    <ChooseEditSourceDialog
      open={open}
      onOpenChange={setOpen}
      t={t}
      drafts={drafts}
      onConfirm={(source) => {
        setOpen(false);
        if (targetNode.current) {
          navigate(targetNode.current, source);
        }
      }}
    />
  );

  return { requestEdit, chooser, preparingEdit: preparing };
}
