import { describe, expect, it } from 'vitest';
import {
  blobObjectKey,
  parseBlobObjectKey,
  planWorkbenchBlobReap,
  WORKBENCH_REAP_GRACE_MS,
} from './workbench-blob-reap.js';

const SPACE = 'spc_1';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = Date.parse('2026-09-01T12:00:00Z');
const OLD = new Date(NOW - WORKBENCH_REAP_GRACE_MS - 60_000).toISOString();
const RECENT = new Date(NOW - 60_000).toISOString();

const ref = (space: string, hash: string) => `${space}|${hash}`;

describe('object key parsing', () => {
  it('round-trips a well-formed key', () => {
    expect(parseBlobObjectKey(blobObjectKey(SPACE, HASH_A))).toEqual({
      spaceId: SPACE,
      hash: HASH_A,
    });
  });

  it('refuses keys that do not have the fenced shape', () => {
    // Anything unparseable is never handed to a delete: refusing to act on a
    // key we cannot explain is cheaper than the one case where it was live.
    expect(parseBlobObjectKey('spaces/spc_1/blobs/short')).toBeNull();
    expect(parseBlobObjectKey(`spaces/spc_1/kb/${HASH_A}`)).toBeNull();
    expect(parseBlobObjectKey(`spaces/spc_1/blobs/${HASH_A}/extra`)).toBeNull();
    expect(parseBlobObjectKey(`other/spc_1/blobs/${HASH_A}`)).toBeNull();
    expect(parseBlobObjectKey(`spaces//blobs/${HASH_A}`)).toBeNull();
  });
});

describe('workbench blob reap plan', () => {
  const blob = (hash: string, createdAt: string, space = SPACE) => ({
    space_id: space,
    hash,
    created_at: createdAt,
  });

  it('reaps a certified blob nothing references, once past grace', () => {
    const plan = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, OLD)],
      referenced: new Set(),
      objects: [],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.blobReaps).toEqual([
      { spaceId: SPACE, hash: HASH_A, path: blobObjectKey(SPACE, HASH_A) },
    ]);
  });

  it('never touches a referenced blob, however old', () => {
    const plan = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, OLD)],
      referenced: new Set([ref(SPACE, HASH_A)]),
      objects: [],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.blobReaps).toEqual([]);
  });

  it('spares an unreferenced blob still inside the grace window', () => {
    // The certificate may be young because an upload is only now finishing;
    // the grace is the fence around exactly that.
    const plan = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, RECENT)],
      referenced: new Set(),
      objects: [],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.blobReaps).toEqual([]);
  });

  it('keys references by space, so the same content in another space is safe', () => {
    // Cross-space dedup is deliberately not done: the space prefix is the
    // isolation belt, so a reference in one space says nothing about another.
    const plan = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, OLD, 'spc_1'), blob(HASH_A, OLD, 'spc_2')],
      referenced: new Set([ref('spc_1', HASH_A)]),
      objects: [],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.blobReaps).toEqual([
      { spaceId: 'spc_2', hash: HASH_A, path: blobObjectKey('spc_2', HASH_A) },
    ]);
  });

  it('plans no blob reaps at all when the unreferenced leg is disabled', () => {
    // Fail-closed: with no reference source, "unreferenced" is unknowable and
    // guessing would delete a user's file.
    const plan = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, OLD)],
      referenced: new Set(),
      objects: [],
      nowMs: NOW,
      reapUnreferenced: false,
    });

    expect(plan.blobReaps).toEqual([]);
  });

  it('still sweeps orphans while the unreferenced leg is disabled', () => {
    const plan = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, OLD)],
      referenced: new Set(),
      objects: [
        { name: blobObjectKey(SPACE, HASH_A), created_at: OLD },
        { name: blobObjectKey(SPACE, HASH_B), created_at: OLD },
      ],
      nowMs: NOW,
      reapUnreferenced: false,
    });

    // Only the uncertified one: an object with a certificate is never an
    // orphan, whichever leg is running.
    expect(plan.orphanObjectPaths).toEqual([blobObjectKey(SPACE, HASH_B)]);
  });

  it('leaves a young uncertified object alone — its certificate may be seconds away', () => {
    const plan = planWorkbenchBlobReap({
      blobs: [],
      referenced: new Set(),
      objects: [{ name: blobObjectKey(SPACE, HASH_B), created_at: RECENT }],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.orphanObjectPaths).toEqual([]);
  });

  it('ignores objects whose key does not parse rather than deleting them', () => {
    const plan = planWorkbenchBlobReap({
      blobs: [],
      referenced: new Set(),
      objects: [{ name: 'spaces/spc_1/blobs/not-a-hash', created_at: OLD }],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.orphanObjectPaths).toEqual([]);
  });

  it('is stable across re-runs: planning over an already-swept state yields nothing', () => {
    const first = planWorkbenchBlobReap({
      blobs: [blob(HASH_A, OLD)],
      referenced: new Set(),
      objects: [{ name: blobObjectKey(SPACE, HASH_A), created_at: OLD }],
      nowMs: NOW,
      reapUnreferenced: true,
    });
    expect(first.blobReaps).toHaveLength(1);

    // Apply it: the row and the object are gone.
    const second = planWorkbenchBlobReap({
      blobs: [],
      referenced: new Set(),
      objects: [],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(second).toEqual({ blobReaps: [], orphanObjectPaths: [] });
  });

  it('collects the residue of a crash between row delete and object delete', () => {
    // The crash window leaves an object with no certificate — precisely what
    // the orphan leg exists for, and the reason the delete order is row-first.
    const plan = planWorkbenchBlobReap({
      blobs: [],
      referenced: new Set(),
      objects: [{ name: blobObjectKey(SPACE, HASH_A), created_at: OLD }],
      nowMs: NOW,
      reapUnreferenced: true,
    });

    expect(plan.orphanObjectPaths).toEqual([blobObjectKey(SPACE, HASH_A)]);
  });
});
