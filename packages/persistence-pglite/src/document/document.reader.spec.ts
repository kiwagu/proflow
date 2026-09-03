import { describe, expect, it } from 'vitest';
import type { AppDb } from '../db/db.js';
import { createPgliteDocumentListReader } from './document.reader.js';

type Ping = { document_id: string; writer: string | null; updated_at: string };

/**
 * A database whose live feed we drive by hand, and whose content reads
 * answer from a map — enough to exercise what the reader decides, which is
 * which pings are news.
 */
function fakeDb(initialRows: Ping[] = []) {
  let listener: ((res: { rows: Ping[] }) => void) | undefined;
  const content = new Map<string, unknown>();
  const db = {
    live: {
      query: async <T>(
        _sql: string,
        _params: unknown[],
        cb: (res: { rows: T[] }) => void
      ) => {
        listener = cb as unknown as (res: { rows: Ping[] }) => void;
        return {
          // What the query answers the moment it attaches: the state the
          // feed takes as its baseline.
          initialResults: { rows: initialRows as unknown as T[] },
          unsubscribe: () => {
            listener = undefined;
          },
        };
      },
    },
    query: async <T>(_sql: string, params?: unknown[]) => {
      const id = String(params?.[0]);
      const stored = content.get(id);
      return { rows: (stored ? [{ lexical_json: stored }] : []) as T[] };
    },
  };
  return {
    db: db as unknown as AppDb,
    setContent: (id: string, tree: unknown) => content.set(id, tree),
    deliver: (rows: Ping[]) => listener?.({ rows }),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the shared content feed', () => {
  it('delivers the first save of a document that had no content yet', async () => {
    const fake = fakeDb();
    const reader = createPgliteDocumentListReader(fake.db);
    const seen: Array<{ writer: string | null }> = [];
    reader.watchContent('doc-1', (content) => seen.push(content));
    await settle();

    // The feed opens on a document nobody has saved: no content row at all.
    fake.deliver([]);
    await settle();
    expect(seen).toEqual([]);

    // Another tab saves it for the first time. For a tab watching an
    // unsaved document this is the only news there will ever be, and
    // taking it for a baseline is how a second tab stays empty forever.
    fake.setContent('doc-1', { root: 'first' });
    fake.deliver([
      { document_id: 'doc-1', writer: 'wrt-other', updated_at: '1' },
    ]);
    await settle();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.writer).toBe('wrt-other');
  });

  it('treats what is already stored when it opens as baseline', async () => {
    const fake = fakeDb([
      { document_id: 'doc-1', writer: 'wrt-a', updated_at: '1' },
    ]);
    const reader = createPgliteDocumentListReader(fake.db);
    const seen: unknown[] = [];
    reader.watchContent('doc-1', (content) => seen.push(content));
    await settle();
    fake.setContent('doc-1', { root: 'stored' });
    expect(seen).toEqual([]);

    // An unchanged row stays quiet; a changed one is news.
    fake.deliver([{ document_id: 'doc-1', writer: 'wrt-a', updated_at: '1' }]);
    await settle();
    expect(seen).toEqual([]);

    fake.deliver([{ document_id: 'doc-1', writer: 'wrt-a', updated_at: '2' }]);
    await settle();
    expect(seen).toHaveLength(1);
  });

  it('says nothing about documents nobody is watching', async () => {
    const fake = fakeDb();
    const reader = createPgliteDocumentListReader(fake.db);
    const seen: unknown[] = [];
    reader.watchContent('doc-1', (content) => seen.push(content));
    await settle();
    fake.deliver([]);

    fake.setContent('doc-2', { root: 'other' });
    fake.deliver([{ document_id: 'doc-2', writer: 'wrt-b', updated_at: '1' }]);
    await settle();
    expect(seen).toEqual([]);
  });
});
