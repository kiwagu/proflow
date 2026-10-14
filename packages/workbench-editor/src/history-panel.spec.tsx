/**
 * The history panel, over versions it does not own.
 *
 * Four behaviours are asserted, each of them where a history surface usually
 * breaks: an empty document must say so rather than show an empty box, the
 * newest version must be at the TOP whatever order the store handed the list
 * in, a click must hand back the version that was clicked, and restore must
 * act on the version being previewed rather than on whatever is first.
 */
import type { DocumentVersion } from '@workspace/domain';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './history-panel.js';
import { versionAge } from './history.js';

afterEach(() => {
  cleanup();
});

const NOW = new Date('2026-01-01T12:00:00Z');

function version(
  id: string,
  minutesAgo: number,
  overrides: Partial<DocumentVersion> = {}
): DocumentVersion {
  return {
    id,
    documentId: 'doc-1',
    label: null,
    kind: 'idle',
    ref: { [id]: minutesAgo },
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    ...overrides,
  };
}

describe('the history panel', () => {
  it('says the document has no versions instead of showing an empty list', () => {
    render(
      <HistoryPanel versions={[]} onPreview={() => {}} onRestore={() => {}} />
    );

    expect(screen.getByTestId('history-empty')).toBeTruthy();
    expect(screen.queryByTestId('history-list')).toBeNull();
  });

  it('lists every version newest first, whatever order it was handed', () => {
    // Deliberately oldest-first: the panel must not depend on the store's
    // ordering to put the newest version at the top.
    render(
      <HistoryPanel
        versions={[
          version('v-old', 30),
          version('v-mid', 10),
          version('v-new', 1),
        ]}
        now={NOW}
        onPreview={() => {}}
        onRestore={() => {}}
      />
    );

    const rows = screen.getAllByTestId('history-version');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('1 min ago');
    expect(rows[2]?.textContent).toContain('30 min ago');
  });

  it('hands back the version that was clicked, not its position', () => {
    const onPreview = vi.fn();
    const versions = [version('v-old', 30), version('v-new', 1)];
    render(
      <HistoryPanel
        versions={versions}
        now={NOW}
        onPreview={onPreview}
        onRestore={() => {}}
      />
    );

    // The second row is the OLDER version once the panel has ordered them.
    fireEvent.click(screen.getAllByTestId('history-version')[1]!);

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0]?.[0]).toBe(versions[0]);
    expect(onPreview.mock.calls[0]?.[0].ref).toEqual({ 'v-old': 30 });
  });

  it('restores the version being previewed', () => {
    const onRestore = vi.fn();
    const versions = [version('v-old', 30), version('v-new', 1)];
    render(
      <HistoryPanel
        versions={versions}
        selectedId="v-old"
        now={NOW}
        onPreview={() => {}}
        onRestore={onRestore}
      />
    );

    fireEvent.click(screen.getByTestId('history-restore'));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0]?.[0]).toBe(versions[0]);
  });

  it('shows the preview only while a version is selected', () => {
    const { rerender } = render(
      <HistoryPanel
        versions={[version('v-new', 1)]}
        now={NOW}
        preview={<p>previewed content</p>}
        onPreview={() => {}}
        onRestore={() => {}}
      />
    );

    expect(screen.queryByTestId('history-preview')).toBeNull();

    rerender(
      <HistoryPanel
        versions={[version('v-new', 1)]}
        selectedId="v-new"
        now={NOW}
        preview={<p>previewed content</p>}
        onPreview={() => {}}
        onRestore={() => {}}
      />
    );

    expect(screen.getByTestId('history-preview')).toBeTruthy();
    expect(screen.getByText('previewed content')).toBeTruthy();
  });
});

describe('how old a version reads', () => {
  it('scales the unit with the elapsed time', () => {
    expect(versionAge(new Date(NOW.getTime() - 5_000), NOW)).toEqual({
      unit: 'now',
    });
    expect(versionAge(new Date(NOW.getTime() - 5 * 60_000), NOW)).toEqual({
      unit: 'minutes',
      count: 5,
    });
    expect(versionAge(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toEqual({
      unit: 'hours',
      count: 3,
    });
    expect(versionAge(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toEqual({
      unit: 'days',
      count: 2,
    });
  });

  it('reads a version marked in the future as just now', () => {
    expect(versionAge(new Date(NOW.getTime() + 60_000), NOW)).toEqual({
      unit: 'now',
    });
  });
});
