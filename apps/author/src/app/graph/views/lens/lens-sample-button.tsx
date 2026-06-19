'use client';

import type { GraphTranslator } from '@workspace/i18n-catalogs/graph';
import { Button } from '@workspace/ui/components/button';
import { Sparkles } from 'lucide-react';
import * as React from 'react';

/**
 * LensSampleButton — the owner-priority "quick immersion" affordance (slice-11 Ф2
 * §1). It POSTs the landed `/author/graph/sample` route, which builds an example
 * graph exercising every capability UNDER THE USER'S RLS (the user's own data,
 * not a system seed), then refreshes the canvas. A 409 (already seeded) flips the
 * button to a disabled "already exists" state rather than erroring — the build is
 * idempotent. THIN: no seed logic here, only the POST + state (ADR-0005 §b). RLS
 * is the sole authority — an ungranted caller's POST fails cleanly (422).
 *
 * Shown PROMINENTLY in the empty editor (next to "New", §1) so a fresh user is
 * never staring at a blank slate.
 */

export type LensSampleButtonProps = {
  spaceId: string;
  t: GraphTranslator;
  onSeeded: () => void;
  /** Larger, primary presentation when shown in the empty editor. */
  prominent?: boolean;
};

export function LensSampleButton({
  spaceId,
  t,
  onSeeded,
  prominent = false,
}: LensSampleButtonProps) {
  const [busy, setBusy] = React.useState(false);
  const [alreadyExists, setAlreadyExists] = React.useState(false);
  const [error, setError] = React.useState(false);

  async function onCreate() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch('/author/graph/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceId }),
      });
      if (res.status === 409) {
        setAlreadyExists(true);
        return;
      }
      if (!res.ok) {
        setError(true);
        return;
      }
      onSeeded();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? t('graph.sample.creating')
    : alreadyExists
      ? t('graph.sample.alreadyExists')
      : t('graph.sample.button');

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant={prominent ? 'default' : 'outline'}
        size={prominent ? 'default' : 'sm'}
        onClick={onCreate}
        disabled={busy || alreadyExists}
      >
        <Sparkles className="size-4" aria-hidden />
        {label}
      </Button>
      {prominent ? (
        <p className="text-muted-foreground max-w-md text-xs">
          {t('graph.sample.hint')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {t('graph.sample.error')}
        </p>
      ) : null}
    </div>
  );
}
