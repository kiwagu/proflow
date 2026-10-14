import type { ISemanticSearch } from '@workspace/domain';

export type { SearchHit } from '@workspace/domain';

/**
 * Where a search engine's answers come from. The two engines share one
 * result shape, so a consumer cannot tell them apart except by reach:
 *
 *   - `local`  — the replica on this device. Works offline, reflects
 *                unsynced edits instantly, covers everything the device holds.
 *   - `server` — the space-wide index behind the server's search endpoint.
 *                Reaches documents the device never pulled; needs a network.
 */
export type SearchReach = 'local' | 'server';

/**
 * The port the search lens reads through.
 *
 * Deliberately narrower than the engine port (`ISemanticSearch`): the lens
 * only ever asks a question, never indexes — indexing follows the document
 * save, which the editor owns. Keeping the surface this small is what lets a
 * second engine slot in without the lens changing: a server-backed provider
 * is the same two members over an HTTP call, and a future "both" provider
 * would compose two of these and pick by reach.
 */
export interface SearchProvider {
  readonly reach: SearchReach;
  readonly search: ISemanticSearch['search'];
}

/**
 * The local engine as a provider — the product's search. Hybrid vector +
 * full-text over the local database with reciprocal-rank fusion; the engine
 * embeds the query with the same local model that embedded the chunks, so
 * the vectors are always comparable.
 */
export function localSearchProvider(engine: ISemanticSearch): SearchProvider {
  return {
    reach: 'local',
    search: (query, opts) => engine.search(query, opts),
  };
}
