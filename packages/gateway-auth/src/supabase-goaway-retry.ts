/**
 * Transport-level retry for a graceful HTTP/2 `GOAWAY`.
 *
 * The local edge (and any HTTP/2 reverse proxy) periodically retires a pooled
 * connection by sending `GOAWAY` with code 0 (NO_ERROR) — after
 * `keepalive_requests`, after `keepalive_time`, or when a worker cycles. Streams
 * above the frame's `last-stream-id` are explicitly *not processed*, so the peer
 * is expected to replay them on a fresh connection. Node's fetch does not: it
 * surfaces the frame as `InformationalError` / `UND_ERR_INFO` and rejects with
 * `TypeError: fetch failed`, which postgrest-js then reports as
 * `TypeError: terminated` on a query that never reached Postgres.
 *
 * Because the server states it did not process the stream, replaying it once is
 * safe for any method — the request has no observable effect to duplicate. The
 * retry is deliberately bounded to one attempt and to this exact signature: a
 * genuine upstream failure still fails, immediately and visibly.
 */
function isUnprocessedGoawayError(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (!cause || typeof cause !== 'object') {
    return false;
  }
  const { code, message } = cause as { code?: unknown; message?: unknown };
  return code === 'UND_ERR_INFO' && String(message ?? '').includes('GOAWAY');
}

/** `fetch` that replays a request the peer refused with a graceful `GOAWAY`. */
export async function fetchRetryingGoaway(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isUnprocessedGoawayError(error)) {
      throw error;
    }
  }
  // A single replay on a fresh connection. Expressed without recursion so a
  // peer that keeps sending `GOAWAY` surfaces on the second attempt instead of
  // retrying forever.
  return fetch(input, init);
}
