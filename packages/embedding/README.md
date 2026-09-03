# `@workspace/embedding`

Text to vectors: the chunking policy, the real model in a worker, and a
deterministic double.

## Role in the architecture

Driven-adapter package, and the only workspace member that declares
`@huggingface/transformers`. Implements the domain's `IEmbeddingService`.
Depends on `@workspace/domain` and nothing else in the workspace; the
persistence package consumes its chunking so that indexing and search can
never disagree about how a document was split.

## What it holds

- **`passageWindows`** — one window over the head of the text plus
  overlapping windows over the rest. Models of this class read ~512 tokens
  and truncate silently, so text outside the embedded window is invisible
  to search; the windows are what make a long document findable past its
  first page.
- **`createWorkerEmbedder`** — MiniLM (384 dimensions, quantized, ~25 MB
  downloaded once and cached by the browser) running in a dedicated worker,
  because embedding a document is a batch job of seconds and the UI thread
  has an editor on it.
- **`./testing` → `createHashEmbedder`** — token-hash vectors: instant,
  offline, deterministic, and semantics-free. They preserve token-overlap
  similarity, which is enough to exercise the whole pipeline in tests;
  anything asserting real semantic similarity needs the real model and
  says so.

## The model id

Every embedder names its model, and every stored chunk carries that name.
Vectors from different models live in different spaces — comparing them is
meaningless — so the id is what makes stale chunks detectable, and startup
reconciliation re-embeds anything whose id no longer matches.

## Testing

`bun run test` at the root; chunking and the hash embedder have colocated
specs. The worker embedder needs a browser and is covered end to end.
