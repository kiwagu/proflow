import type { AppDb } from '../db/db.js';
import { createPgliteGraphRepository } from './graph.repository.js';

type Transaction = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/** Join the caller's transaction rather than opening a nested transaction.
 * The caller must throw on an Err result to roll back the entire operation.
 */
export function graphInTransaction(tx: Transaction) {
  return createPgliteGraphRepository({
    query: tx.query.bind(tx),
    transaction: async (run) => run(tx),
  });
}
