# `@workspace/ai-ops`

Document operations for AI-driven edits: a small vocabulary of operations
(`DocumentOp`), an editor API that produces them, and the applier that
commits them to a live Lexical document by stable node id.

## Role in the architecture

A pure library package, like `@workspace/lexical-nodes`, which it depends on for
the node classes and the node-id plugin. It has no network, no storage and no
framework dependency; everything in it runs in the browser and is exercised by
its unit tests with a headless editor.

The split it enforces: **producing** operations is a model's job, and whoever
runs the model (a gateway in the app's composition root) hands back a
`DocumentOp[]`; **applying** them is deterministic and lives here, so an edit
lands in the user's own undo stack and is attributed to them, not to a remote
session.

## What is here

- `editor/` — the op vocabulary (`ops.ts`) and `DocumentEditor`, the
  ergonomic builder a model-facing runtime codes against.
- `doc/` — `Doc`, the applier: resolves node ids through the editor's id
  mapping and performs each op inside an editor update.
- `ai-toolkit/` — the `$`-helpers `Doc` is built from (locate, inline, lists,
  tables, blocks, modify) and the headless editing session used by tests.
- `queue/` — turns an op list into keystroke-sized steps for animated
  application. Pure; optional.

Tests are `*.spec.ts` beside the code they cover.
