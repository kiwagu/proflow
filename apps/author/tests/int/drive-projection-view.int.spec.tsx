import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import { cleanup, fireEvent, render, screen } from '../test-utils';
import * as React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DriveProjectionView } from '@/app/graph/views/drive/drive-projection.view';
import type { ProjectionViewProps } from '@/app/graph/views/registry/projection-view.types';

/**
 * DriveProjectionView — first forward-port pass from `feat/knowledge-kb-workbench`.
 * The view is 1:1 with the authoritative prototype and PURELY presentational: its
 * only inputs are the resolved `ProjectionResult` + the i18n catalog + the server
 * KB seed (`kbData`). These tests render it with in-memory props (no backend), so
 * they prove the shell + the real containment traversal render correctly while the
 * backend data loaders are still a gap (Phase 2).
 */

let messages: Record<string, string>;

// Display-gate verbs (ADR-0006): these presentational tests render the shell, not the
// capability gate, so the fail-closed default (no verbs) keeps each `KbViewData` literal
// valid. The dedicated capability assertions live in the e2e (real RLS verdicts).
const NO_CAPS = {
  canUpdate: false,
  canDelete: false,
  canCreate: false,
  canAccess: false,
} as const;

// The commercial entitlement (ADR-0022) — fail-closed off for these presentational
// tests; the Flat/Advanced toggle's entitled/locked behaviour is covered by the e2e.
const NO_ENTITLEMENTS = { advancedStructuralView: false } as const;

beforeAll(async () => {
  messages = await loadGraphMessages('en');
});

// This suite renders the same shell repeatedly and queries shared roles (the
// "Starred" nav), so each test must start from a clean DOM.
afterEach(() => cleanup());

function baseProps(
  overrides: Partial<ProjectionViewProps> = {}
): ProjectionViewProps {
  const result: ProjectionResult = {
    projection_id: 'prj_test',
    view: 'drive',
    items: [],
  };
  return {
    result,
    messages,
    onSelect: vi.fn(),
    onMutated: vi.fn(),
    refreshKey: 0,
    spaceId: 'spc_test',
    ...overrides,
  };
}

/**
 * Folder location is CONTROLLED by the workbench (the URL `?folder=`), so a test
 * that browses must own that state itself. This wrapper holds `folderId` and wires
 * `onNavigate` exactly as the real `DriveWorkbench` does — the in-memory equivalent
 * of the URL round-trip.
 */
function ControlledDrive(props: ProjectionViewProps) {
  const [folderId, setFolderId] = React.useState<string | null>(
    props.folderId ?? null
  );
  return (
    <DriveProjectionView
      {...props}
      folderId={folderId}
      onNavigate={(id) => setFolderId(id)}
    />
  );
}

/** A folder with one contained document — the minimal containment forest. */
function folderWithDoc(): Pick<ProjectionViewProps, 'result' | 'kbData'> {
  return {
    result: {
      projection_id: 'prj_test',
      view: 'drive',
      items: [
        { id: 'knr_folder', kind: 'folder', title: 'Docs' },
        { id: 'knr_doc', kind: 'text', title: 'Welcome' },
      ] as ProjectionResult['items'],
    },
    kbData: {
      attributesByItem: {},
      metaByItem: {},
      containment: [{ from: 'knr_folder', to: 'knr_doc', position: 0 }],
      shortcuts: [],
      currentUserId: null,
      starredIds: [],
      openedAtById: {},
      capabilities: NO_CAPS,
      entitlements: NO_ENTITLEMENTS,
      trash: { items: [], metaByItem: {} },
      sharedByMe: [],
      shareMechanism: {},
    },
  };
}

describe('DriveProjectionView (forward-port shell)', () => {
  it('renders the Drive chrome and the empty-editor state with no data', () => {
    render(<DriveProjectionView {...baseProps()} />);

    // sidebar chrome
    expect(screen.getByRole('button', { name: /New/ })).toBeTruthy();
    expect(screen.getByText('Sections')).toBeTruthy();
    // toolbar chrome (grid/list toggle is local UI state, no backend)
    expect(screen.getByLabelText('Grid view')).toBeTruthy();
    expect(screen.getByLabelText('List view')).toBeTruthy();
    // empty canvas → the prototype empty-editor copy
    expect(screen.getByText(messages['graph.lens.emptyEditor']!)).toBeTruthy();
  });

  it('builds the containment forest from real edges and browses a folder', () => {
    render(<ControlledDrive {...baseProps(folderWithDoc())} />);

    // root folder surfaces both in the sidebar section list AND as a canvas card
    const folderButtons = screen.getAllByRole('button', { name: /Docs/ });
    expect(folderButtons.length).toBeGreaterThan(0);

    // navigating into it lists the contained document (childContent traversal)
    fireEvent.click(folderButtons[0]!);
    expect(screen.getByText('Welcome')).toBeTruthy();
  });

  it('filters the canvas to the starred set when the Starred nav is active', () => {
    const props = baseProps(folderWithDoc());
    render(
      <DriveProjectionView
        {...props}
        kbData={{ ...props.kbData!, starredIds: ['knr_doc'] }}
      />
    );

    // At the root the contained doc is hidden (it lives inside the folder).
    expect(screen.queryByText('Welcome')).toBeNull();

    // The Starred filter is a flat lens across the space → the starred doc shows,
    // its star reads as "Remove star" (already starred).
    fireEvent.click(screen.getByRole('button', { name: 'Starred' }));
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove star' })).toBeTruthy();
  });

  it('shows the empty-starred copy when nothing is starred', () => {
    render(<DriveProjectionView {...baseProps(folderWithDoc())} />);

    fireEvent.click(screen.getByRole('button', { name: 'Starred' }));
    expect(
      screen.getByText(messages['graph.drive.starredEmpty']!)
    ).toBeTruthy();
  });

  it('lists opened content most-recently-viewed first under the Recent filter', () => {
    const props = baseProps({
      result: {
        projection_id: 'prj_test',
        view: 'drive',
        items: [
          { id: 'knr_old', kind: 'text', title: 'Older' },
          { id: 'knr_new', kind: 'text', title: 'Newer' },
          { id: 'knr_folder', kind: 'folder', title: 'Docs' },
        ] as ProjectionResult['items'],
      },
      kbData: {
        attributesByItem: {},
        metaByItem: {
          knr_old: {
            ownerUserId: null,
            lastModifiedAt: '2026-01-01T00:00:00Z',
          },
          knr_new: {
            ownerUserId: null,
            lastModifiedAt: '2026-06-01T00:00:00Z',
          },
        },
        containment: [],
        shortcuts: [],
        currentUserId: null,
        starredIds: [],
        // Recent = opened by me, newest open first. The folder has no open entry
        // (and folders are excluded regardless).
        openedAtById: {
          knr_old: '2026-01-01T00:00:00Z',
          knr_new: '2026-06-01T00:00:00Z',
        },
        capabilities: NO_CAPS,
        entitlements: NO_ENTITLEMENTS,
        trash: { items: [], metaByItem: {} },
        sharedByMe: [],
        shareMechanism: {},
      },
    });
    render(<DriveProjectionView {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));

    // The canvas lists exactly the two opened docs, most-recently-viewed
    // (`last_opened_at`) first — the folder is excluded (no open entry anyway).
    const titles = screen
      .getAllByText(/^(Older|Newer)$/)
      .map((node) => node.textContent);
    expect(titles).toEqual(['Newer', 'Older']);
  });

  it('shows the empty-recent copy when there is no content', () => {
    render(
      <DriveProjectionView
        {...baseProps({
          result: {
            projection_id: 'prj_test',
            view: 'drive',
            items: [
              { id: 'knr_folder', kind: 'folder', title: 'Docs' },
            ] as ProjectionResult['items'],
          },
          kbData: {
            attributesByItem: {},
            metaByItem: {},
            containment: [],
            shortcuts: [],
            currentUserId: null,
            starredIds: [],
            openedAtById: {},
            capabilities: NO_CAPS,
            entitlements: NO_ENTITLEMENTS,
            trash: { items: [], metaByItem: {} },
            sharedByMe: [],
            shareMechanism: {},
          },
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(screen.getByText(messages['graph.drive.recentEmpty']!)).toBeTruthy();
  });

  it('lists loose top-level content at the Drive root (not only inside folders)', () => {
    render(
      <DriveProjectionView
        {...baseProps({
          result: {
            projection_id: 'prj_test',
            view: 'drive',
            items: [
              { id: 'knr_folder', kind: 'folder', title: 'Docs' },
              { id: 'knr_loose', kind: 'text', title: 'LooseDoc' },
            ] as ProjectionResult['items'],
          },
          kbData: {
            attributesByItem: {},
            metaByItem: {},
            containment: [], // no contains edges → both sit at the root
            shortcuts: [],
            currentUserId: null,
            starredIds: [],
            openedAtById: {},
            capabilities: NO_CAPS,
            entitlements: NO_ENTITLEMENTS,
            trash: { items: [], metaByItem: {} },
            sharedByMe: [],
            shareMechanism: {},
          },
        })}
      />
    );

    // The default (kb) root lists the loose document next to the folder — it is no
    // longer invisible until filed under a folder (only reachable via Recent).
    expect(screen.getByText('LooseDoc')).toBeTruthy();
  });

  // ── Trash lens (ADR-0018 §10.7) ──────────────────────────────────────────

  /** A trashed node — the seed for the Trash lens (`kbData.trash`). It is NOT in the
   * live canvas/containment (which is `deleted_at IS NULL`); the trashed set rides
   * alongside as its own resolved lens. */
  function withTrash(
    items: { id: string; kind: string; title: string }[]
  ): Partial<ProjectionViewProps> {
    const props = baseProps();
    return {
      kbData: {
        ...props.kbData!,
        ...{
          attributesByItem: {},
          metaByItem: {},
          containment: [],
          shortcuts: [],
          currentUserId: null,
          starredIds: [],
          openedAtById: {},
        },
        capabilities: NO_CAPS,
        entitlements: NO_ENTITLEMENTS,
        trash: { items, metaByItem: {} },
      },
    };
  }

  it('shows the empty-trash copy when nothing is trashed', () => {
    render(
      <DriveProjectionView
        {...baseProps()}
        scope="trash"
        onScopeChange={vi.fn()}
      />
    );
    expect(screen.getByText(messages['graph.trash.empty']!)).toBeTruthy();
  });

  it('renders trashed nodes with Restore + Delete-forever in the Trash lens', () => {
    render(
      <DriveProjectionView
        {...baseProps(
          withTrash([{ id: 'knr_gone', kind: 'text', title: 'Old Draft' }])
        )}
        scope="trash"
        onScopeChange={vi.fn()}
        onRestore={vi.fn(async () => true)}
        onPurge={vi.fn(async () => 'purged' as const)}
      />
    );

    expect(screen.getByText('Old Draft')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: messages['graph.trash.restore']! })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: messages['graph.trash.purge']! })
    ).toBeTruthy();
  });

  it('restores a trashed node via the Trash lens action', () => {
    const onRestore = vi.fn(async () => true);
    render(
      <DriveProjectionView
        {...baseProps(
          withTrash([{ id: 'knr_gone', kind: 'text', title: 'Old Draft' }])
        )}
        scope="trash"
        onScopeChange={vi.fn()}
        onRestore={onRestore}
        onPurge={vi.fn(async () => 'purged' as const)}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: messages['graph.trash.restore']! })
    );
    expect(onRestore).toHaveBeenCalledWith('knr_gone');
  });

  it('confirms before purging (the one-way door) and only then calls onPurge', () => {
    const onPurge = vi.fn(async () => 'purged' as const);
    render(
      <DriveProjectionView
        {...baseProps(
          withTrash([{ id: 'knr_gone', kind: 'text', title: 'Old Draft' }])
        )}
        scope="trash"
        onScopeChange={vi.fn()}
        onRestore={vi.fn(async () => true)}
        onPurge={onPurge}
      />
    );

    // Clicking "Delete forever" opens the confirm — it does NOT purge yet.
    fireEvent.click(
      screen.getByRole('button', { name: messages['graph.trash.purge']! })
    );
    expect(onPurge).not.toHaveBeenCalled();

    // The confirm dialog shows the purge prompt; confirming fires the purge.
    expect(
      screen.getByText(
        messages['graph.trash.purgeConfirm']!.replace('{title}', 'Old Draft')
      )
    ).toBeTruthy();
    const confirms = screen.getAllByRole('button', {
      name: messages['graph.trash.purge']!,
    });
    // The dialog's confirm button is the last one (the card trigger is the first).
    fireEvent.click(confirms[confirms.length - 1]!);
    expect(onPurge).toHaveBeenCalledWith('knr_gone');
  });

  // ── Clipboard indicator (active vs read-only) ───────────────────────────

  /** A clipboard set on a node, with the paste wiring the workbench supplies. */
  const clipboardProps = {
    clipboard: { sourceId: 'knr_doc', title: 'Welcome' },
    onPaste: vi.fn(),
    onClearClipboard: vi.fn(),
  } as const;

  it('shows the ACTIVE Paste control (clickable) + clear ✕ in the kb scope', () => {
    render(
      <DriveProjectionView
        {...baseProps()}
        {...clipboardProps}
        scope="kb"
        onScopeChange={vi.fn()}
      />
    );

    // The active chip: a clickable Paste labelled with the (root) paste verb …
    const paste = screen.getByRole('button', {
      name: messages['graph.drive.pasteRoot']!.replace('{title}', 'Welcome'),
    });
    expect(paste.tagName).toBe('BUTTON');
    fireEvent.click(paste);
    expect(clipboardProps.onPaste).toHaveBeenCalled();

    // … and the clear ✕.
    expect(
      screen.getByRole('button', { name: messages['graph.drive.pasteClear']! })
    ).toBeTruthy();

    // The read-only hint is NOT rendered while the active control is.
    expect(
      screen.queryByLabelText(
        messages['graph.drive.clipboardHint']!.replace('{title}', 'Welcome')
      )
    ).toBeNull();
  });

  it('shows the READ-ONLY clipboard chip (clear ✕ present, NO active Paste) in a flat lens', () => {
    render(
      <DriveProjectionView
        {...baseProps()}
        {...clipboardProps}
        scope="shared"
        onScopeChange={vi.fn()}
      />
    );

    // The muted hint: an indicator carrying the clipboard title + accessible label.
    const hint = screen.getByLabelText(
      messages['graph.drive.clipboardHint']!.replace('{title}', 'Welcome')
    );
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain('Welcome');

    // NO interactive paste affordance in the read-only state (nowhere to paste here).
    expect(
      screen.queryByRole('button', {
        name: messages['graph.drive.paste']!.replace('{title}', 'Welcome'),
      })
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: messages['graph.drive.pasteRoot']!.replace('{title}', 'Welcome'),
      })
    ).toBeNull();

    // …but the clear ✕ IS now present, and clicking it fires onClearClipboard — the
    // buffer can be cleared from EVERY lens, not just KB / Escape.
    const clear = screen.getByRole('button', {
      name: messages['graph.drive.pasteClear']!,
    });
    expect(clear).toBeTruthy();
    clipboardProps.onClearClipboard.mockClear();
    fireEvent.click(clear);
    expect(clipboardProps.onClearClipboard).toHaveBeenCalled();
  });

  // ── §14 graceful-absence: a referenced-but-absent node never throws ──────

  it('renders a parent folder even when a contained child is absent from the item set (TOCTOU)', () => {
    // A `contains` edge points at `knr_ghost`, but that node is NOT in the resolved
    // item set (it was trashed BETWEEN the items query and the edges query — the
    // §14 TOCTOU window). The tree-builder must skip the absent slot, NOT throw.
    render(
      <ControlledDrive
        {...baseProps({
          result: {
            projection_id: 'prj_test',
            view: 'drive',
            items: [
              { id: 'knr_folder', kind: 'folder', title: 'Docs' },
              { id: 'knr_doc', kind: 'text', title: 'Welcome' },
            ] as ProjectionResult['items'],
          },
          kbData: {
            attributesByItem: {},
            metaByItem: {},
            containment: [
              { from: 'knr_folder', to: 'knr_doc', position: 0 },
              // dangling edge → a node absent from the item set (graceful absence)
              { from: 'knr_folder', to: 'knr_ghost', position: 1 },
            ],
            shortcuts: [],
            currentUserId: null,
            starredIds: [],
            openedAtById: {},
            capabilities: NO_CAPS,
            entitlements: NO_ENTITLEMENTS,
            trash: { items: [], metaByItem: {} },
            sharedByMe: [],
            shareMechanism: {},
          },
        })}
      />
    );

    // The folder still renders (no thrown render / error boundary).
    const folderButtons = screen.getAllByRole('button', { name: /Docs/ });
    expect(folderButtons.length).toBeGreaterThan(0);

    // Navigating in shows the present child; the absent child is simply not shown.
    fireEvent.click(folderButtons[0]!);
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.queryByText('knr_ghost')).toBeNull();
  });
});
