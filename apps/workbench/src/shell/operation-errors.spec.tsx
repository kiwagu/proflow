/**
 * The one visible channel for failed operations.
 *
 * An offline-first app has no server round-trip to fail loudly; a save, a
 * move, a push that did not go through would otherwise only ever reach the
 * console. These cases pin down the channel's contract: a failure shows up
 * with its text, a failure reported again under the same key REPLACES the
 * earlier one instead of piling up, resolving the key withdraws it, and a
 * retry that succeeds clears it while one that does not leaves it standing.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../test-utils';
import {
  createOperationErrors,
  failureText,
  OperationErrorsView,
} from './operation-errors';

describe('the operation-error channel', () => {
  it('keeps one failure per key, newest text wins', () => {
    const errors = createOperationErrors();
    errors.report('first');
    errors.report('busy', { key: 'save:doc-1' });
    errors.report('still busy', { key: 'save:doc-1' });

    expect(errors.snapshot().map((f) => f.message)).toEqual([
      'first',
      'still busy',
    ]);
  });

  it('withdraws a keyed failure when the operation goes through after all', () => {
    const errors = createOperationErrors();
    errors.report('busy', { key: 'save:doc-1' });
    errors.resolve('save:doc-1');
    expect(errors.snapshot()).toEqual([]);
  });

  it('tells subscribers on every change and hands out a stable snapshot between them', () => {
    const errors = createOperationErrors();
    const listener = vi.fn();
    errors.subscribe(listener);
    const before = errors.snapshot();
    expect(errors.snapshot()).toBe(before);

    errors.report('x');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(errors.snapshot()).not.toBe(before);
  });
});

describe('the failures as the user sees them', () => {
  it('shows a reported failure and lets the user dismiss it', () => {
    const errors = createOperationErrors();
    render(<OperationErrorsView errors={errors} />);
    expect(screen.queryByTestId('operation-error')).toBeNull();

    act(() => errors.report('Could not rename the folder.'));
    expect(screen.getByTestId('operation-error').textContent).toContain(
      'Could not rename the folder.'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('operation-error')).toBeNull();
  });

  it('reads a catalog message, so the composition root can report without a translator', async () => {
    const errors = createOperationErrors();
    render(<OperationErrorsView errors={errors} />);
    act(() =>
      errors.report({
        kind: 'save',
        title: 'Notes',
        reason: 'the database is busy',
      })
    );
    expect(await screen.findByText(/Could not save “Notes”/)).toBeTruthy();
  });

  it('puts a structured failure into words through the catalog, by literal key', () => {
    // A translator that echoes what it was asked: the key and the values.
    const t = (key: string, vars?: Record<string, string | number>) =>
      `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;
    expect(
      failureText({ kind: 'save', title: 'Notes', reason: 'busy' }, t)
    ).toBe('workbench.errors.save {"title":"Notes","reason":"busy"}');
    expect(failureText({ kind: 'sync', reason: 'down' }, t)).toBe(
      'workbench.errors.sync {"reason":"down"}'
    );
    expect(failureText({ kind: 'sync-stalled' }, t)).toBe(
      'workbench.errors.syncStalled'
    );
    expect(failureText('as is', t)).toBe('as is');
    // Without a catalog, the English default.
    expect(failureText({ kind: 'sync-stalled' }, null)).toContain('waiting');
  });

  it('names the document a push failed for, and tells a failed pull from a failed send', () => {
    const t = (key: string, vars?: Record<string, string | number>) =>
      `${key}${vars ? ' ' + JSON.stringify(vars) : ''}`;
    expect(
      failureText({ kind: 'push', title: 'Notes', reason: 'denied' }, t)
    ).toBe('workbench.errors.push {"title":"Notes","reason":"denied"}');
    expect(failureText({ kind: 'pull', reason: 'down' }, t)).toBe(
      'workbench.errors.pull {"reason":"down"}'
    );
    expect(
      failureText({ kind: 'push', title: 'Notes', reason: 'denied' }, null)
    ).toContain('“Notes”');
    expect(failureText({ kind: 'pull', reason: 'down' }, null)).toContain(
      'latest changes'
    );
  });

  it('offers a retry when the operation can be repeated, and clears the failure once it succeeds', async () => {
    const errors = createOperationErrors();
    let attempts = 0;
    const retry = vi.fn(async () => {
      attempts += 1;
      return attempts >= 2;
    });
    render(<OperationErrorsView errors={errors} />);
    act(() => errors.report('Could not move “Plan”.', { retry }));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    // Still failing: the notice stays.
    expect(screen.getByTestId('operation-error')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByTestId('operation-error')).toBeNull()
    );
  });

  it('keeps one notice through a retry that fails again under the same key, and none once it succeeds', async () => {
    const errors = createOperationErrors();
    let attempts = 0;
    const move = async (): Promise<boolean> => {
      attempts += 1;
      if (attempts < 3) {
        // What a real operation does on failure: report again, same key.
        errors.report(`Could not move (attempt ${attempts}).`, {
          key: 'move:n1',
          retry: move,
        });
        return false;
      }
      return true;
    };
    render(<OperationErrorsView errors={errors} />);
    act(() => void move());
    expect(screen.getAllByTestId('operation-error')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByTestId('operation-error').textContent).toContain(
        'attempt 2'
      )
    );
    expect(screen.getAllByTestId('operation-error')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByTestId('operation-error')).toBeNull()
    );
  });

  it('lets a newer failure under the same key outlive an older retry that succeeds', async () => {
    const errors = createOperationErrors();
    let finish!: (ok: boolean) => void;
    const slowRetry = () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    render(<OperationErrorsView errors={errors} />);
    act(() =>
      errors.report('Could not move “Plan” into A.', {
        key: 'move:n1',
        retry: slowRetry,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // While that retry is pending, another attempt on the same node fails.
    act(() =>
      errors.report('Could not move “Plan” into B.', { key: 'move:n1' })
    );
    expect(screen.getByTestId('operation-error').textContent).toContain(
      'into B'
    );

    await act(async () => {
      finish(true);
    });
    expect(screen.getByTestId('operation-error').textContent).toContain(
      'into B'
    );
  });

  it('never blocks the page: the region is a polite live region, not a dialog', () => {
    const errors = createOperationErrors();
    render(<OperationErrorsView errors={errors} />);
    act(() => errors.report('x'));
    const region = screen.getByRole('region', { name: 'Problems' });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
