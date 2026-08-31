import { describe, expect, it } from 'vitest';
import { DocumentCrdt } from './document.crdt.js';
import { MissingNodeIdError, type SerializedNode } from './tree.js';

const AUTHOR = { user: 'local-user', src: 'human' } as const;

/** Element node with a stable id, in the shape the editor serializes. */
function el(
  id: string,
  type: string,
  children: SerializedNode[],
  props: Record<string, unknown> = {}
): SerializedNode {
  return { type, $: { id }, children, ...props };
}

function text(id: string, value: string): SerializedNode {
  return { type: 'text', $: { id }, text: value, format: 0 };
}

function tree(...children: SerializedNode[]) {
  return { root: el('root', 'root', children) };
}

describe('DocumentCrdt', () => {
  it('round-trips a nested tree', () => {
    const doc = DocumentCrdt.create();
    const input = tree(
      el('p1', 'paragraph', [text('t1', 'hello')], { indent: 0 }),
      el('h1', 'heading', [text('t2', 'title')], { tag: 'h1' })
    );

    doc.commitTree(input, AUTHOR);

    expect(doc.toTree()).toEqual(input);
  });

  it('reads back as null before anything is written', () => {
    expect(DocumentCrdt.create().toTree()).toBeNull();
  });

  it('records a timestamp and the author on every commit', () => {
    const doc = DocumentCrdt.create();
    doc.commitTree(tree(el('p1', 'paragraph', [text('t1', 'hi')])), AUTHOR);

    const changes = doc.listChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.at).toBeGreaterThan(0);
    expect(changes[0]?.author).toEqual(AUTHOR);
  });

  it('adds no history entry when the tree is unchanged', () => {
    const doc = DocumentCrdt.create();
    const input = tree(el('p1', 'paragraph', [text('t1', 'hi')]));

    expect(doc.commitTree(input, AUTHOR)).toBe(true);
    expect(doc.commitTree(input, AUTHOR)).toBe(false);
    expect(doc.listChanges()).toHaveLength(1);
  });

  it('rejects a node without a stable id', () => {
    const doc = DocumentCrdt.create();
    const orphan: SerializedNode = { type: 'paragraph', children: [] };

    expect(() => doc.commitTree(tree(orphan), AUTHOR)).toThrow(
      MissingNodeIdError
    );
  });

  describe('minimal operations', () => {
    it('costs a handful of ops to edit one character, not a rewrite', () => {
      const doc = DocumentCrdt.create();
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        el(`p${i}`, 'paragraph', [text(`t${i}`, `paragraph number ${i}`)])
      );
      doc.commitTree(tree(...paragraphs), AUTHOR);
      const afterFirstWrite = doc.opCount();

      const edited = paragraphs.map((p, i) =>
        i === 7 ? el('p7', 'paragraph', [text('t7', 'paragraph number 7!')]) : p
      );
      doc.commitTree(tree(...edited), AUTHOR);

      // One appended character is one insert. A subtree replacement would
      // cost tens of ops here, which is what makes the history useless.
      expect(doc.opCount() - afterFirstWrite).toBeLessThanOrEqual(2);
      expect(doc.toTree()).toEqual(tree(...edited));
    });

    it('reorders by moving, keeping the moved node its own history', () => {
      const doc = DocumentCrdt.create();
      const a = el('a', 'paragraph', [text('ta', 'first')]);
      const b = el('b', 'paragraph', [text('tb', 'second')]);
      doc.commitTree(tree(a, b), AUTHOR);
      const afterFirstWrite = doc.opCount();

      doc.commitTree(tree(b, a), AUTHOR);

      // A move is one operation per relocated child; delete + re-insert would
      // recreate the containers and lose everything written into them.
      expect(doc.opCount() - afterFirstWrite).toBeLessThanOrEqual(2);
      expect(doc.toTree()).toEqual(tree(b, a));
    });

    it('does not touch siblings when one child is removed', () => {
      const doc = DocumentCrdt.create();
      const a = el('a', 'paragraph', [text('ta', 'keep')]);
      const b = el('b', 'paragraph', [text('tb', 'drop')]);
      const c = el('c', 'paragraph', [text('tc', 'keep too')]);
      doc.commitTree(tree(a, b, c), AUTHOR);
      const afterFirstWrite = doc.opCount();

      doc.commitTree(tree(a, c), AUTHOR);

      expect(doc.opCount() - afterFirstWrite).toBeLessThanOrEqual(2);
      expect(doc.toTree()).toEqual(tree(a, c));
    });
  });

  describe('persistence', () => {
    it('restores tree and history from a snapshot', () => {
      const doc = DocumentCrdt.create();
      doc.commitTree(tree(el('p1', 'paragraph', [text('t1', 'one')])), AUTHOR);
      doc.commitTree(tree(el('p1', 'paragraph', [text('t1', 'one two')])), {
        user: 'local-user',
        src: 'ai',
        model: 'test-model',
      });

      const restored = DocumentCrdt.fromSnapshot(doc.exportSnapshot());

      expect(restored.toTree()).toEqual(doc.toTree());
      expect(restored.listChanges()).toHaveLength(2);
      expect(restored.listChanges()[1]?.author?.src).toBe('ai');
    });

    it('restores from journal entries alone, with no snapshot yet', () => {
      const doc = DocumentCrdt.create();
      const journal: Uint8Array[] = [];
      doc.onLocalUpdate((bytes) => journal.push(bytes));
      const written = tree(el('p1', 'paragraph', [text('t1', 'only journal')]));
      doc.commitTree(written, AUTHOR);

      // A document is journal-only until it is first snapshotted, which is
      // most of its early life. Dropping the journal for want of a snapshot
      // loses everything and looks like a document that was never written.
      const restored = DocumentCrdt.restore({ updates: journal });

      expect(restored.toTree()).toEqual(written);
    });

    it('replays journal entries on top of a snapshot', () => {
      const doc = DocumentCrdt.create();
      doc.commitTree(tree(el('p1', 'paragraph', [text('t1', 'one')])), AUTHOR);
      const snapshot = doc.exportSnapshot();

      // Everything written after the snapshot arrives as journal entries.
      const journal: Uint8Array[] = [];
      doc.onLocalUpdate((bytes) => journal.push(bytes));
      doc.commitTree(
        tree(el('p1', 'paragraph', [text('t1', 'one two')])),
        AUTHOR
      );

      const restored = DocumentCrdt.fromSnapshot(snapshot, journal);

      expect(restored.toTree()).toEqual(doc.toTree());
    });
  });

  describe('versions', () => {
    it('reads a past version without detaching the live document', () => {
      const doc = DocumentCrdt.create();
      const first = tree(el('p1', 'paragraph', [text('t1', 'draft')]));
      doc.commitTree(first, AUTHOR);
      const marked = doc.frontiers();

      const second = tree(el('p1', 'paragraph', [text('t1', 'final')]));
      doc.commitTree(second, AUTHOR);

      expect(doc.readAt(marked)).toEqual(first);
      // The live document is untouched and still editable.
      expect(doc.toTree()).toEqual(second);
    });

    it('restores a version while keeping the later ones reachable', () => {
      const doc = DocumentCrdt.create();
      const first = tree(el('p1', 'paragraph', [text('t1', 'draft')]));
      doc.commitTree(first, AUTHOR);
      const marked = doc.frontiers();
      const second = tree(el('p1', 'paragraph', [text('t1', 'final')]));
      doc.commitTree(second, AUTHOR);
      const abandoned = doc.frontiers();

      doc.revertTo(marked, AUTHOR);

      expect(doc.toTree()).toEqual(first);
      // Restore appends inverse operations rather than truncating, so the
      // version that was reverted away from is still addressable.
      expect(doc.readAt(abandoned)).toEqual(second);
    });

    it('addresses every save precisely, even when changes merge', () => {
      const doc = DocumentCrdt.create();
      const v1 = tree(el('p1', 'paragraph', [text('t1', 'one')]));
      const v2 = tree(el('p1', 'paragraph', [text('t1', 'two')]));
      const v3 = tree(el('p1', 'paragraph', [text('t1', 'three')]));
      doc.commitTree(v1, AUTHOR);
      const f1 = doc.frontiers();
      doc.commitTree(v2, AUTHOR);
      const f2 = doc.frontiers();
      doc.commitTree(v3, AUTHOR);

      // Loro merges consecutive commits that share an author and fall inside
      // its change-merge interval, so the change log is coarser than the list
      // of saves. Frontiers are not: they advance per commit. This is why a
      // saved version stores a frontier and never a change index.
      expect(doc.listChanges().length).toBeLessThan(3);
      expect(doc.readAt(f1)).toEqual(v1);
      expect(doc.readAt(f2)).toEqual(v2);
      expect(doc.toTree()).toEqual(v3);
    });

    it('starts a new change when the author changes', () => {
      const doc = DocumentCrdt.create();
      doc.commitTree(
        tree(el('p1', 'paragraph', [text('t1', 'human')])),
        AUTHOR
      );
      doc.commitTree(tree(el('p1', 'paragraph', [text('t1', 'assisted')])), {
        user: 'local-user',
        src: 'ai',
        model: 'test-model',
      });

      // Authorship boundaries survive merging because the commit message
      // differs — which is what keeps "the assistant wrote this" answerable.
      expect(doc.listChanges().map((c) => c.author?.src)).toEqual([
        'human',
        'ai',
      ]);
    });
  });
});
