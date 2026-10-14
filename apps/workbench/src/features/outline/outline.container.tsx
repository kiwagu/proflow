/**
 * The outline panel over the editor the pane has open.
 *
 * The panel is a sibling of the editor, not a child, so the library's
 * `Outline` — which reads the editor from its mount's context — is given
 * that context here, from the live-editor registry. Keyed by the document:
 * a switch remounts the heading list under the new editor instead of
 * carrying the old one's state across.
 */
import {
  LexicalWrapperContext,
  type LexicalWrapper,
} from '@workspace/lexical-react';
import { EmptyState } from '@workspace/ui/components/empty-state';
import {
  Outline,
  shouldShowOutline,
  useOutlineHeadings,
} from '@workspace/workbench-editor';
import { useLiveEditor } from '../live-editor';
import {
  defaultOutlinePanelLabels,
  type OutlinePanelLabels,
} from './outline.labels';

export function OutlinePanelContainer({
  documentId,
  labels = defaultOutlinePanelLabels,
}: {
  documentId: string;
  labels?: OutlinePanelLabels;
}) {
  const live = useLiveEditor(documentId);
  return (
    <section
      aria-label={labels.ariaLabel}
      data-testid="outline-panel"
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <h2 className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
        {labels.title}
      </h2>
      {live ? (
        <OpenOutline key={documentId} wrapper={live.wrapper} labels={labels} />
      ) : (
        <EmptyState data-testid="outline-empty">{labels.empty}</EmptyState>
      )}
    </section>
  );
}

function OpenOutline({
  wrapper,
  labels,
}: {
  wrapper: LexicalWrapper;
  labels: OutlinePanelLabels;
}) {
  // The library's outline hides itself below its minimum; the panel says why
  // rather than standing empty.
  const headings = useOutlineHeadings(wrapper.editor);
  if (!shouldShowOutline(headings.length))
    return <EmptyState data-testid="outline-empty">{labels.empty}</EmptyState>;
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <Outline
        labels={{ nav: labels.nav }}
        // The editable is the element that scrolls (the mount gives it the
        // overflow), so it is both where headings live and what to scroll.
        scrollContainer={wrapper.editor.getRootElement()}
        className="w-full"
      />
    </LexicalWrapperContext.Provider>
  );
}
