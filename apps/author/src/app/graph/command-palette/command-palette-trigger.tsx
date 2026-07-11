'use client';

import { createGraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import * as React from 'react';

/**
 * CommandPaletteTrigger — the top-bar affordance that opens the command palette
 * (slice-12 Phase 3). Styled as the canonical shadcn search trigger: an input-like,
 * left-aligned muted button with a placeholder label and a ⌘K keyboard badge pinned
 * to the right. The palette also opens on ⌘K/Ctrl+K; this clickable trigger gives a
 * discoverable entry point AND a reliable e2e hook (a spec can click it rather than
 * synthesise a global ⌘K).
 */
export function CommandPaletteTrigger({
  messages,
  onOpen,
}: {
  messages: Record<string, string>;
  onOpen: () => void;
}) {
  const t = React.useMemo(() => createGraphTranslator(messages), [messages]);

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      data-testid="command-palette-trigger"
      aria-label={t('graph.commandPalette.open')}
      className="bg-muted/50 text-muted-foreground hover:bg-accent relative h-8 w-44 justify-start rounded-md px-4 text-sm font-normal shadow-none sm:pr-12 lg:w-56 xl:w-64"
    >
      <span>{t('graph.commandPalette.open')}</span>
      <kbd className="bg-muted pointer-events-none absolute top-[0.3rem] right-[0.3rem] hidden h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none sm:flex">
        {t('graph.commandPalette.shortcut')}
      </kbd>
    </Button>
  );
}
