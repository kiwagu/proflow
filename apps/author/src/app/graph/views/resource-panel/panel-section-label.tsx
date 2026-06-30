import * as React from 'react';

/**
 * PanelSectionLabel — the uppercase, icon-led header shared by every ResourcePanel
 * section (Access / Description / Versions). It is the `text-muted-foreground flex
 * items-center gap-1.5 text-xs font-semibold tracking-[0.04em] uppercase` cluster that
 * each section re-declared inline; promoting it keeps the rendered header IDENTICAL
 * while removing the triplicated className (ui-primitive-hygiene). Icon + label are the
 * caller's (passed as children) — mechanism only.
 */
export function PanelSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] uppercase">
      {children}
    </div>
  );
}
