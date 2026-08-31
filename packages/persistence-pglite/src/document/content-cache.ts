import type { DocumentMeta, SerializedTree } from '@workspace/domain';

export type CachedContent = { tree: SerializedTree; markdown: string };
export type CachedDocument = { meta: DocumentMeta; content: CachedContent };

/**
 * Trees this client has already paid for — its own saves, its own loads,
 * and remote changes it fetched. Opening a document it has seen costs no
 * query and no wait in the connection's queue; the CRDT stays canonical
 * and the database's derived cache stays the cross-client truth.
 */
export function createContentCache(limit = 12) {
  const entries = new Map<string, CachedDocument>();
  return {
    get(id: string): CachedDocument | undefined {
      const hit = entries.get(id);
      if (hit) {
        // Refresh recency: Map iterates in insertion order.
        entries.delete(id);
        entries.set(id, hit);
      }
      return hit;
    },
    set(id: string, entry: CachedDocument): void {
      entries.delete(id);
      entries.set(id, entry);
      if (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
    drop(id: string): void {
      entries.delete(id);
    },
  };
}

export type ContentCache = ReturnType<typeof createContentCache>;
