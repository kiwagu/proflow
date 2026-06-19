// MOCK — pending backend (slice-11), for owner discussion.
//
// The Drive ItemCard + the panel header show a meta line: a file's SIZE, a video's
// DURATION, or a link's HOST (prototype `n.meta`). The REAL values live in the `kb`
// `resource_media_meta` satellite (`byte_size` / `duration_ms` / `mime_type`) and the
// `resource_link` satellite (`host`) — both are read for real by
// `loadKbAttributesForItems`. But binary upload is a deferred slice, so most demo
// media rows are EMPTY (no real byte size / duration captured yet).
//
// To reach pixel-1:1 NOW and surface that gap, this module returns a DETERMINISTIC
// size/duration derived from the node id ONLY WHEN the real satellite row is absent
// (owner directive: a labelled stub, never a silent fake). The link host is always
// REAL (it is stored). When binary upload lands, delete this fallback — the real
// `byteSize`/`durationMs` will already flow through `loadKbAttributesForItems`.

/** A stable small hash of a node id → a deterministic mock number. */
function seededInt(id: string, min: number, max: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

/** Deterministic mock byte-size for a file node whose real row is empty (KB range). */
export function mockByteSize(nodeId: string): number {
  // 40 KB – 8 MB, deterministic per id.
  return seededInt(nodeId, 40, 8192) * 1024;
}

/** Deterministic mock duration (ms) for a video node whose real row is empty. */
export function mockDurationMs(nodeId: string): number {
  // 45s – 18m, deterministic per id.
  return seededInt(nodeId, 45, 1080) * 1000;
}
