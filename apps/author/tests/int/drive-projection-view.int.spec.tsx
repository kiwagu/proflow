import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
          },
        })}
      />
    );

    // The default (kb) root lists the loose document next to the folder — it is no
    // longer invisible until filed under a folder (only reachable via Recent).
    expect(screen.getByText('LooseDoc')).toBeTruthy();
  });
});
