import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@workspace/persistence-pglite';
import {
  allFolders,
  ancestorsOf,
  buildContainment,
  childContent,
  childFolders,
  isSelfOrDescendant,
  pathTo,
  rootContent,
  rootFolders,
} from './containment.js';

/**
 * The containment index — pure derivation over the rows the live queries
 * deliver. It is rebuilt on every change rather than stored, so what matters
 * is that it survives the shapes a partially-pulled replica really produces:
 * an edge whose endpoint has not arrived, a node with several parents, a cycle
 * the server has not rejected yet.
 */

const node = (id: string, kind: string, title = id): GraphNode =>
  ({ id, kind, title, status: 'active' }) as GraphNode;

const edge = (from: string, to: string, position = 0): GraphEdge =>
  ({ from, to, position, relationType: 'contains' }) as GraphEdge;

describe('building the folder tree', () => {
  it('separates folders from content at the root and inside a folder', () => {
    const containment = buildContainment(
      [
        node('folder', 'folder'),
        node('nested', 'folder'),
        node('doc', 'text'),
        node('loose', 'text'),
        node('label', 'tag'),
      ],
      [edge('folder', 'nested'), edge('folder', 'doc')]
    );

    expect(rootFolders(containment).map((n) => n.id)).toEqual(['folder']);
    // A document created without a folder is visible at the root, where it was
    // made — not hidden until someone files it.
    expect(rootContent(containment).map((n) => n.id)).toEqual(['loose']);
    expect(childFolders(containment, 'folder').map((n) => n.id)).toEqual([
      'nested',
    ]);
    expect(childContent(containment, 'folder').map((n) => n.id)).toEqual([
      'doc',
    ]);
    // Tags are ordinary nodes but are a facet, never drive content.
    expect(rootContent(containment).map((n) => n.id)).not.toContain('label');
    expect(allFolders(containment).map((n) => n.id)).toEqual([
      'folder',
      'nested',
    ]);
  });

  it('orders children by their edge position, not by arrival', () => {
    const containment = buildContainment(
      [node('folder', 'folder'), node('a', 'text'), node('b', 'text')],
      [edge('folder', 'b', 0), edge('folder', 'a', 1)]
    );
    expect(childContent(containment, 'folder').map((n) => n.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('ignores an edge whose other end has not been pulled yet', () => {
    // Pull batches are per table and independent, so an edge can land before
    // its node. The tree has to render rather than fail on that.
    const containment = buildContainment(
      [node('folder', 'folder')],
      [edge('folder', 'not-here-yet')]
    );
    expect(childContent(containment, 'folder')).toEqual([]);
    expect(rootFolders(containment).map((n) => n.id)).toEqual(['folder']);
  });
});

describe('walking up from a node', () => {
  it('gives the breadcrumb from the root down and the ancestors outward', () => {
    const containment = buildContainment(
      [node('top', 'folder'), node('mid', 'folder'), node('doc', 'text')],
      [edge('top', 'mid'), edge('mid', 'doc')]
    );

    expect(pathTo(containment, 'doc').map((n) => n.id)).toEqual([
      'top',
      'mid',
      'doc',
    ]);
    // Nearest-first and excluding the node: "the closest folder that…" reads
    // the first match rather than the last.
    expect(ancestorsOf(containment, 'doc').map((n) => n.id)).toEqual([
      'mid',
      'top',
    ]);
  });

  it('stays bounded when the rows describe a cycle', () => {
    // The server guards acyclicity, but a replica can hold a moment where two
    // pulled edges disagree; rendering must not hang on it.
    const containment = buildContainment(
      [node('a', 'folder'), node('b', 'folder')],
      [edge('a', 'b'), edge('b', 'a')]
    );
    expect(pathTo(containment, 'b').length).toBeLessThanOrEqual(2);
    expect(isSelfOrDescendant(containment, 'a', 'b')).toBe(true);
  });
});

describe('the drop guard', () => {
  const containment = buildContainment(
    [
      node('root', 'folder'),
      node('child', 'folder'),
      node('grandchild', 'folder'),
      node('other', 'folder'),
    ],
    [edge('root', 'child'), edge('child', 'grandchild')]
  );

  it('refuses the node itself and everything under it', () => {
    expect(isSelfOrDescendant(containment, 'root', 'root')).toBe(true);
    expect(isSelfOrDescendant(containment, 'root', 'child')).toBe(true);
    // Depth is not the limit — any descendant would orphan the same cycle.
    expect(isSelfOrDescendant(containment, 'root', 'grandchild')).toBe(true);
  });

  it('allows an unrelated folder, and the way back up the tree', () => {
    expect(isSelfOrDescendant(containment, 'root', 'other')).toBe(false);
    // Moving a child OUT to its own grandparent is an ordinary move.
    expect(isSelfOrDescendant(containment, 'grandchild', 'root')).toBe(false);
  });
});
