import * as React from 'react';

import { SectionLabel } from '@workspace/ui/components/section-label';

/**
 * PanelSectionLabel — the uppercase, icon-led header shared by every ResourcePanel
 * section (Access / Description / Versions). A thin app-local alias over the shared
 * `SectionLabel` primitive that fixes the panel's flex+gap layout; icon + label are
 * the caller's (passed as children).
 */
export function PanelSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <SectionLabel className="flex items-center gap-1.5">
      {children}
    </SectionLabel>
  );
}
