/**
 * @file The one visible channel for operations that did not go through.
 *
 * Saves, moves, renames, restores and the push of local changes all fail
 * locally and quietly in an offline-first app: there is no request whose
 * failure the browser would show. This channel is where such a failure is
 * put so the user learns of it, and the composition root is its only owner —
 * every surface reports through the `reportError` port it was handed.
 *
 * Two rules keep it honest rather than noisy. A failure reported under a KEY
 * replaces the earlier one under that key, so a retry loop that fails every
 * second shows one notice, not sixty; and resolving a key withdraws the
 * notice, so a save that lands after three refusals leaves nothing behind.
 * A failure that can be repeated carries its own retry — the channel never
 * invents one.
 */
import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';
import { Button } from '@workspace/ui/components/button';
import { Card, CardContent } from '@workspace/ui/components/card';
import { useState, useSyncExternalStore } from 'react';
import { useWorkbenchTranslator } from '../i18n';

/**
 * What a notice says: a resolved string, or one of the failures the app
 * itself names, which the view puts into words from the catalog — so a
 * report made where no translator exists (the composition root, a port's
 * retry loop) still reaches the user in their language.
 */
export type FailureText =
  | string
  | { kind: 'save'; title: string; reason: string }
  | { kind: 'sync'; reason: string }
  | { kind: 'sync-stalled' }
  | { kind: 'push'; title: string; reason: string }
  | { kind: 'pull'; reason: string }
  | { kind: 'refused'; id: string };

export interface ReportOptions {
  /** One notice per key: a later report replaces, `resolve` withdraws. */
  key?: string;
  /** Repeats the operation; resolves true once it went through. */
  retry?: () => Promise<boolean>;
}

export type ReportError = (
  message: FailureText,
  options?: ReportOptions
) => void;

export interface OperationFailure {
  id: number;
  key?: string;
  message: FailureText;
  retry?: () => Promise<boolean>;
}

export interface OperationErrors {
  report: ReportError;
  /** Withdraws the notice under `key`: the operation went through after all. */
  resolve(key: string): void;
  dismiss(id: number): void;
  subscribe(listener: () => void): () => void;
  /** The same array until something changes — what a store reader expects. */
  snapshot(): readonly OperationFailure[];
}

export function createOperationErrors(): OperationErrors {
  let failures: readonly OperationFailure[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const publish = (next: readonly OperationFailure[]) => {
    failures = next;
    for (const listener of listeners) listener();
  };
  return {
    report(message, options = {}) {
      const failure: OperationFailure = {
        id: nextId++,
        message,
        ...(options.key ? { key: options.key } : {}),
        ...(options.retry ? { retry: options.retry } : {}),
      };
      const kept = options.key
        ? failures.filter((f) => f.key !== options.key)
        : failures;
      publish([...kept, failure]);
    },
    resolve(key) {
      if (!failures.some((f) => f.key === key)) return;
      publish(failures.filter((f) => f.key !== key));
    },
    dismiss(id) {
      if (!failures.some((f) => f.id === id)) return;
      publish(failures.filter((f) => f.id !== id));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => failures,
  };
}

/**
 * A failure in words: a string as it is; a structured failure through the
 * catalog by its literal key, or the English default while no catalog is
 * loaded.
 */
export function failureText(
  message: FailureText,
  t: WorkbenchTranslator | null
): string {
  if (typeof message === 'string') return message;
  switch (message.kind) {
    case 'save':
      return t
        ? t('workbench.errors.save', {
            title: message.title,
            reason: message.reason,
          })
        : `Could not save “${message.title}”: ${message.reason}. Trying again…`;
    case 'sync':
      return t
        ? t('workbench.errors.sync', { reason: message.reason })
        : `Changes made here could not be sent to the server: ${message.reason}. They stay on this device and are sent again automatically.`;
    case 'sync-stalled':
      return t
        ? t('workbench.errors.syncStalled')
        : 'Changes made here are waiting to be sent: the server cannot be reached. They stay on this device and are sent automatically once it answers.';
    case 'push':
      return t
        ? t('workbench.errors.push', {
            title: message.title,
            reason: message.reason,
          })
        : `Could not send “${message.title}” to the server: ${message.reason}. It stays on this device and is sent again automatically.`;
    case 'pull':
      return t
        ? t('workbench.errors.pull', { reason: message.reason })
        : `Could not get the latest changes from the server: ${message.reason}. Trying again automatically.`;
    case 'refused':
      return t
        ? t('workbench.errors.refused', { id: message.id })
        : `The server holds “${message.id}”, which is not a valid id, so it was left out here. Everything else keeps syncing.`;
  }
}

/**
 * The notices, as a strip at the foot of the page that takes its own room.
 * A polite live region, never a dialog and never an overlay: a failed save
 * must not take the keyboard away from the editor, and a notice must not
 * sit over a control — a floating stack did exactly that to the trash
 * panel's buttons.
 */
export function OperationErrorsView({ errors }: { errors: OperationErrors }) {
  const failures = useSyncExternalStore(errors.subscribe, errors.snapshot);
  const t = useWorkbenchTranslator();
  const [busy, setBusy] = useState<number | null>(null);

  const retry = async (failure: OperationFailure) => {
    if (!failure.retry) return;
    setBusy(failure.id);
    try {
      // Only the notice the retry was started from goes: a NEWER failure
      // reported under the same key while this retry was pending is a
      // different attempt, and it stays until its own retry succeeds.
      if (await failure.retry()) errors.dismiss(failure.id);
    } finally {
      setBusy((current) => (current === failure.id ? null : current));
    }
  };

  return (
    <section
      aria-label={t ? t('workbench.errors.ariaLabel') : 'Problems'}
      aria-live="polite"
      className={
        failures.length > 0
          ? 'flex shrink-0 flex-wrap gap-2 border-t px-4 py-2'
          : undefined
      }
    >
      {failures.map((failure) => (
        <Card
          key={failure.id}
          size="sm"
          className="w-80 max-w-full gap-2"
          data-testid="operation-error"
        >
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm">{failureText(failure.message, t)}</p>
            <div className="flex justify-end gap-1">
              {failure.retry ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busy === failure.id}
                  onClick={() => void retry(failure)}
                >
                  {t ? t('workbench.errors.retry') : 'Retry'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => errors.dismiss(failure.id)}
              >
                {t ? t('workbench.errors.dismiss') : 'Dismiss'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
