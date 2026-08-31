import type {
  DocumentContent,
  DocumentMeta,
  IDocumentListReader,
  IDocumentRepository,
  SerializedTree,
} from '@workspace/domain';
import { newId } from '@workspace/domain';
import { err, ok } from 'neverthrow';

type DocumentState = DocumentMeta & {
  deletedAt: Date | null;
  content: DocumentContent | null;
};

export function createInMemoryDocumentStore(): {
  repository: IDocumentRepository;
  reader: IDocumentListReader;
} {
  const rows = new Map<string, DocumentState>();
  const subscribers = new Set<(docs: DocumentMeta[]) => void>();

  function snapshot(): DocumentMeta[] {
    return [...rows.values()]
      .filter((r) => r.deletedAt === null)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(({ deletedAt: _d, content: _c, ...meta }) => meta);
  }
  function notify(): void {
    const docs = snapshot();
    for (const cb of subscribers) cb(docs);
  }

  const contentSubscribers = new Map<
    string,
    Set<(c: { tree: SerializedTree; writer: string | null }) => void>
  >();
  function notifyContent(id: string): void {
    const state = rows.get(id);
    if (!state?.content) return;
    for (const cb of contentSubscribers.get(id) ?? []) {
      cb({ tree: state.content.tree, writer: 'memory' });
    }
  }

  return {
    repository: {
      writer: 'memory',
      invalidate() {},
      async create(input) {
        const meta: DocumentMeta = {
          id: input?.id ?? newId('document'),
          title: input?.title ?? '',
          kind: input?.kind ?? 'md',
          preview: '',
          starred: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(meta.id, { ...meta, deletedAt: null, content: null });
        notify();
        return ok(meta);
      },
      async load(id) {
        const row = rows.get(id);
        if (!row || row.deletedAt) return err(`document ${id} not found`);
        const { deletedAt: _d, content, ...meta } = row;
        return ok({ meta, content });
      },
      async save({ id, tree, markdown, preview }) {
        const row = rows.get(id);
        if (!row) return err(`document ${id} not found`);
        const unchanged =
          JSON.stringify(row.content?.tree) === JSON.stringify(tree);
        row.content = { tree, markdown };
        row.preview = preview;
        row.updatedAt = new Date();
        notify();
        notifyContent(id);
        return ok(!unchanged);
      },
      async rename(id, title) {
        const row = rows.get(id);
        if (!row) return err(`document ${id} not found`);
        row.title = title;
        row.updatedAt = new Date();
        notify();
        return ok(undefined);
      },
      async softDelete(id) {
        const row = rows.get(id);
        if (!row) return err(`document ${id} not found`);
        row.deletedAt = new Date();
        notify();
        return ok(undefined);
      },
    },
    reader: {
      watchRecent(cb) {
        subscribers.add(cb);
        cb(snapshot());
        return () => subscribers.delete(cb);
      },
      watchContent(documentId, cb) {
        let set = contentSubscribers.get(documentId);
        if (!set) {
          set = new Set();
          contentSubscribers.set(documentId, set);
        }
        set.add(cb);
        notifyContent(documentId);
        return () => set.delete(cb);
      },
    },
  };
}
