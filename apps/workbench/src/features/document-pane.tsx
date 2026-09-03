import type { DocumentMeta } from '@workspace/domain';
import { Component, lazy, Suspense, type ReactNode } from 'react';
import { useWorkbenchTranslator } from '../i18n';
import { Spinner } from '../shell/boot-shell';

/**
 * The editor is the heaviest surface in the app — the whole rich-text
 * stack, code highlighting, equations — and none of it is needed to boot,
 * browse the drive, or search. It loads the first time a document opens,
 * as its own chunk, and a fault inside it stays inside the pane: the drive
 * around it keeps working, and the next document opened tries again.
 */
const DocumentEditor = lazy(() =>
  import('./document-editor').then((m) => ({ default: m.DocumentEditor }))
);

export function DocumentPane({ document }: { document: DocumentMeta }) {
  return (
    <EditorBoundary key={document.id}>
      <Suspense fallback={<Opening />}>
        <DocumentEditor document={document} />
      </Suspense>
    </EditorBoundary>
  );
}

function Opening() {
  const t = useWorkbenchTranslator();
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
      <Spinner className="animate-spin" />{' '}
      {t ? t('workbench.app.opening') : 'Opening…'}
    </div>
  );
}

class EditorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state = { error: undefined as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('the editor failed to open', error);
  }

  render() {
    if (this.state.error !== undefined)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-destructive text-sm">
            <EditorFailedMessage />
          </p>
          <p className="text-muted-foreground max-w-md text-xs">
            {String(this.state.error)}
          </p>
        </div>
      );
    return this.props.children;
  }
}

/**
 * A class component cannot call hooks, so the translated failure message
 * is its own function component rendered inside the fallback markup.
 */
function EditorFailedMessage() {
  const t = useWorkbenchTranslator();
  return (
    <>
      {t
        ? t('workbench.app.editorFailed')
        : 'The editor could not open this document.'}
    </>
  );
}
