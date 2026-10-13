import type { SerializedTree } from '@workspace/domain';
import { describe, expect, it } from 'vitest';
import { createLiveDocuments } from './live-documents';

const tree = (text: string): SerializedTree => ({
  root: { type: 'root', children: [{ type: 'paragraph', text }] },
});

describe('the registry of documents an editor holds open', () => {
  it('answers with whatever the editor holds at the moment of asking', () => {
    const live = createLiveDocuments();
    let current = tree('A');
    live.register('doc-1', () => current);

    expect(live.read('doc-1')).toEqual(tree('A'));
    current = tree('B');
    expect(live.read('doc-1')).toEqual(tree('B'));
  });

  it('knows nothing about a document no editor holds', () => {
    const live = createLiveDocuments();
    expect(live.read('doc-1')).toBeNull();
  });

  it('forgets a document once its editor lets go', () => {
    const live = createLiveDocuments();
    const release = live.register('doc-1', () => tree('A'));
    release();
    expect(live.read('doc-1')).toBeNull();
  });

  it('lets a stale release leave a newer registration alone', () => {
    // A remount registers the new editor before the old one's cleanup runs;
    // the old cleanup must not take the new reader down with it.
    const live = createLiveDocuments();
    const releaseOld = live.register('doc-1', () => tree('old'));
    live.register('doc-1', () => tree('new'));
    releaseOld();
    expect(live.read('doc-1')).toEqual(tree('new'));
  });
});
