'use client';

import { Button } from '@workspace/ui/components/button';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * MarkCompleteButton — a small island of interactivity inside the otherwise
 * server-rendered course stepper (slice-05 §4.3). It POSTs the caller's coarse
 * status to the already-landed `/author/graph/progress` endpoint (which writes
 * under the user's RLS session, never service-role), then calls
 * `router.refresh()` so the server re-resolves the projection and re-gates the
 * course — unlocking the next step. No realtime (deferred); the snapshot updates
 * on refresh.
 *
 * The view itself stays presentational: gating arrives as a prop, and the only
 * client behavior is this button. It does NOT decide what is locked; it merely
 * records progress on a step the server already marked unlocked.
 */

export type MarkCompleteButtonProps = {
  spaceId: string;
  resourceId: string;
  label: string;
  pendingLabel: string;
  errorLabel: string;
};

export function MarkCompleteButton({
  spaceId,
  resourceId,
  label,
  pendingLabel,
  errorLabel,
}: MarkCompleteButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const busy = submitting || isPending;

  async function onClick() {
    setError(false);
    setSubmitting(true);
    try {
      const res = await fetch('/author/graph/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spaceId,
          resourceId,
          // POC mark-complete writes only the coarse status (§4.3) — `done` is
          // what unlocks the next step in the gating rule.
          coarseStatus: 'done',
        }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      // Re-resolve + re-gate on the server so the next step unlocks.
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? pendingLabel : label}
      </Button>
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {errorLabel}
        </span>
      ) : null}
    </div>
  );
}
