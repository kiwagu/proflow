import { describe, expect, it } from 'vitest';

import {
  MEDIA_REAP_GRACE_MS,
  planReconcile,
  type ReconcileBlob,
} from './media-reconcile.reap.js';

const NOW = Date.parse('2026-09-01T12:00:00Z');
const SPACE = 'spc_1';

function blob(
  overrides: Partial<ReconcileBlob> & { id: string }
): ReconcileBlob {
  return {
    space_id: SPACE,
    refcount: 0,
    storage_bucket: 'kb-media',
    storage_path: `spaces/${SPACE}/kb/blobs/${overrides.id}/file.bin`,
    created_at: new Date(NOW - MEDIA_REAP_GRACE_MS - 60_000).toISOString(),
    ...overrides,
  };
}

describe('planReconcile', () => {
  it('no-ops over a consistent snapshot', () => {
    const b = blob({ id: 'kmb_a', refcount: 2 });
    const plan = planReconcile({
      blobs: [b],
      kmmBlobIds: ['kmb_a', 'kmb_a'],
      objectPaths: [{ name: b.storage_path, created_at: b.created_at }],
      nowMs: NOW,
    });
    expect(plan).toEqual({
      refcountFixes: [],
      blobReaps: [],
      strayObjectPaths: [],
    });
  });

  it('heals refcount drift to the actual kmm count', () => {
    const plan = planReconcile({
      blobs: [blob({ id: 'kmb_a', refcount: 5 })],
      kmmBlobIds: ['kmb_a'],
      objectPaths: [],
      nowMs: NOW,
    });
    expect(plan.refcountFixes).toEqual([{ blobId: 'kmb_a', refcount: 1 }]);
    expect(plan.blobReaps).toEqual([]);
  });

  it('reaps a dead blob past grace (object + row)', () => {
    const b = blob({ id: 'kmb_dead' });
    const plan = planReconcile({
      blobs: [b],
      kmmBlobIds: [],
      objectPaths: [],
      nowMs: NOW,
    });
    expect(plan.blobReaps).toEqual([
      { blobId: 'kmb_dead', bucket: 'kb-media', path: b.storage_path },
    ]);
  });

  it('never touches a dead blob younger than the grace window', () => {
    const young = blob({
      id: 'kmb_young',
      created_at: new Date(NOW - 60_000).toISOString(),
    });
    const plan = planReconcile({
      blobs: [young],
      kmmBlobIds: [],
      objectPaths: [],
      nowMs: NOW,
    });
    expect(plan.blobReaps).toEqual([]);
  });

  it('never reaps a blob with at least one actual reference, regardless of stored refcount', () => {
    const plan = planReconcile({
      blobs: [blob({ id: 'kmb_live', refcount: 0 })],
      kmmBlobIds: ['kmb_live'],
      objectPaths: [],
      nowMs: NOW,
    });
    expect(plan.blobReaps).toEqual([]);
    // The zero stored refcount still gets healed upward.
    expect(plan.refcountFixes).toEqual([{ blobId: 'kmb_live', refcount: 1 }]);
  });

  it('drops a malformed dead row without handing its path to storage (path=null)', () => {
    const malformed = blob({
      id: 'kmb_bad',
      storage_path: `spaces/OTHER_SPACE/kb/blobs/kmb_bad/file.bin`,
    });
    const plan = planReconcile({
      blobs: [malformed],
      kmmBlobIds: [],
      objectPaths: [],
      nowMs: NOW,
    });
    expect(plan.blobReaps).toEqual([
      { blobId: 'kmb_bad', bucket: 'kb-media', path: null },
    ]);
  });

  it('sweeps stray objects past grace and spares young or referenced paths', () => {
    const live = blob({ id: 'kmb_a', refcount: 1 });
    const oldStray = {
      name: `spaces/${SPACE}/kb/blobs/kmb_gone/file.bin`,
      created_at: new Date(NOW - MEDIA_REAP_GRACE_MS - 1).toISOString(),
    };
    const youngStray = {
      name: `spaces/${SPACE}/kb/blobs/kmb_new/file.bin`,
      created_at: new Date(NOW - 1000).toISOString(),
    };
    const plan = planReconcile({
      blobs: [live],
      kmmBlobIds: ['kmb_a'],
      objectPaths: [
        { name: live.storage_path, created_at: live.created_at },
        oldStray,
        youngStray,
      ],
      nowMs: NOW,
    });
    expect(plan.strayObjectPaths).toEqual([oldStray.name]);
  });

  it('honours a graceMs override (0 reaps everything dead right now)', () => {
    const justDead = blob({
      id: 'kmb_now',
      created_at: new Date(NOW - 10).toISOString(),
    });
    const plan = planReconcile({
      blobs: [justDead],
      kmmBlobIds: [],
      objectPaths: [],
      nowMs: NOW,
      graceMs: 0,
    });
    expect(plan.blobReaps).toHaveLength(1);
  });
});
