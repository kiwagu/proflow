# `@workspace/ai-agent`

The assistant's loop, run in the browser: the chat's model turn with its
document tools, and the document editing session — both hosted in a Web
Worker beside the page.

## Role in the architecture

Driving-side adapter package: it implements the `ILlmGateway` port over the
AI SDK and consumes the document ports (`IDocumentRepository`,
`ISemanticSearch`) through the tools it defines. It never sees a database
— the worker's composition root (in the app) hands it port adapters — and
never chooses a model: models come in from `@workspace/ai-local`.

Why a worker, and why the browser at all: persistence already lives in the
browser, so the loop that reads and edits documents belongs next to it. A
tool call is a database query, an edit session is a model conversation plus
a JavaScript sandbox; neither belongs on the thread that paints. A
dedicated Web Worker holds them (a Service Worker is killed on idle and is
the wrong host for streams and WebAssembly state). If a server ever hosts
part of this — sync, a shared agent — it is a Bun service, not a
proprietary worker runtime.

## What is here

- `chat/` — `createAgentGateway` (the `ILlmGateway` on `streamText` with
  tools), `createDocumentTools` (ReadContent, ReadMetadata, ContentSearch,
  NameSearch, ListFiles, CreateDocument, RenameDocument, EditDocument — named and
  shaped as the chat's renderers expect), `createEditDocument` (the
  EditDocument capability: run the session, land the result).
- `editing/` — the editing session: supervisor / interpreter / coder agents
  with their prompts, the `runCode` sandbox over QuickJS, and
  `runEditSession`, which runs it all on a headless copy of a document and
  returns operations plus the resulting state.
- `worker/` — the page↔worker protocol: `createAgentWorkerClient` (the
  page's gateway proxy, plus `editDocument` for the selection popup and the
  "is this document open?" hook) and `serveAgent` (the worker side).

An edit lands in one of two places: into the open editor through its own op
applier (so it joins the user's undo stack), or — when no editor has the
document — into the store as an edit attributed to the assistant.
