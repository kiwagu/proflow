import type { Result } from 'neverthrow';

export interface SearchHit {
  documentId: string;
  title: string;
  /** The best-matching excerpt of the document. */
  excerpt: string;
  score: number;
}

/**
 * Port: finding documents by meaning and by words at once.
 *
 * Indexing lives on the same port as searching because they must agree on
 * everything — the chunking, the model, the table — and splitting them into
 * two ports would turn that agreement into a convention.
 */
export interface ISemanticSearch {
  search(
    query: string,
    opts?: { limit?: number }
  ): Promise<Result<SearchHit[], string>>;
  /**
   * (Re)indexes one document from its stored content. Idempotent; replaces
   * whatever chunks the document had, including chunks from an older model.
   */
  indexDocument(documentId: string): Promise<Result<void, string>>;
}
