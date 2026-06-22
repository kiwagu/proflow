import type { ProjectionResult } from '@workspace/knowledge-contracts';
import { loadGraphMessages } from '@workspace/i18n-catalogs/graph';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
    const result: ProjectionResult = {
      projection_id: 'prj_test',
      view: 'drive',
      items: [
        { id: 'knr_folder', kind: 'folder', title: 'Docs' },
        { id: 'knr_doc', kind: 'text', title: 'Welcome' },
      ] as ProjectionResult['items'],
    };
    render(
      <DriveProjectionView
        {...baseProps({
          result,
          kbData: {
            attributesByItem: {},
            metaByItem: {},
            containment: [{ from: 'knr_folder', to: 'knr_doc', position: 0 }],
            shortcuts: [],
            currentUserId: null,
          },
        })}
      />
    );

    // root folder surfaces both in the sidebar section list AND as a canvas card
    const folderButtons = screen.getAllByRole('button', { name: /Docs/ });
    expect(folderButtons.length).toBeGreaterThan(0);

    // navigating into it lists the contained document (childContent traversal)
    fireEvent.click(folderButtons[0]!);
    expect(screen.getByText('Welcome')).toBeTruthy();
  });
});
