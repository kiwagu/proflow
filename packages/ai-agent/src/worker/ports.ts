/**
 * The ports the page serves for its worker, and how they cross.
 *
 * The local database is exclusive: it lives in one PGlite worker whose files
 * a single context holds. Tabs cope by electing a leader among themselves,
 * but the agent worker is a NESTED worker — opening a client there starts a
 * second PGlite worker that contends for the same files, and the page's own
 * boot then fails with "another tab is holding the database". A worker that
 * only reads and writes documents does not need its own client; it needs the
 * one the page already owns.
 *
 * So the ports are messages, the way this protocol already carries the open
 * editor's state (`read-state` / `apply-edit`). The worker asks, the page
 * answers from its single database, and there is no second opener to contend
 * with.
 */
import type {
  DocumentMeta,
  FileNode,
  IDocumentRepository,
  ISemanticSearch,
} from '@workspace/domain';
import type { Result } from 'neverthrow';

/** Which port a call is for. */
export type AgentPortName = 'documents' | 'search' | 'lists';

/** What the page serves. The agent's tools reach the database only through this. */
export interface AgentPagePorts {
  documents: IDocumentRepository;
  search: ISemanticSearch;
  listDocuments: () => Promise<DocumentMeta[]>;
  listFiles: () => Promise<FileNode[]>;
}

/**
 * A `Result` as it survives structured cloning.
 *
 * `neverthrow`'s Ok/Err are class instances, and cloning strips a prototype:
 * the far side would receive an object with no `isOk`. A plain shape crosses
 * and is rebuilt where it is needed.
 */
export type WireResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

/** True for a `neverthrow` Result, which must be flattened before it crosses. */
function isResult(value: unknown): value is Result<unknown, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isOk' in value &&
    typeof (value as { isOk: unknown }).isOk === 'function'
  );
}

/** Flattens a port's answer for the wire; passes plain values through. */
export function toWireValue(value: unknown): unknown {
  if (!isResult(value)) return value;
  return value.isOk()
    ? { ok: true, value: value.value }
    : { ok: false, error: String(value.error) };
}

/**
 * Runs one port call against the page's ports.
 *
 * Unknown ports and methods reject rather than resolve: a typo in the worker
 * would otherwise look like a document that does not exist.
 */
export async function callAgentPort(
  ports: AgentPagePorts,
  port: AgentPortName,
  method: string,
  args: unknown[]
): Promise<unknown> {
  if (port === 'lists') {
    if (method === 'listDocuments') return ports.listDocuments();
    if (method === 'listFiles') return ports.listFiles();
    throw new Error(`unknown list port method: ${method}`);
  }
  const target: Record<string, unknown> =
    port === 'documents'
      ? (ports.documents as unknown as Record<string, unknown>)
      : (ports.search as unknown as Record<string, unknown>);
  const fn = target[method];
  if (typeof fn !== 'function')
    throw new Error(`unknown ${port} port method: ${method}`);
  return (fn as (...a: unknown[]) => unknown).apply(target, args);
}
