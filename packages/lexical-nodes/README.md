# `@workspace/lexical-nodes`

The editor's node vocabulary: custom Lexical nodes, markdown transformers,
node-id assignment, and the registries the UI renders decorators through.

## Role in the architecture

Vendored adapter package — the editor's data layer, framework-agnostic and
free of any UI. It declares the whole `lexical` family, pinned to one exact
version, and nothing else of consequence. Depends on no other workspace
package; the app and the CRDT layer both sit above it.

## Vendored code

This tree is adapted from an external editor codebase rather than written
here, which shapes how it is maintained:

- **It is not reformatted.** Keeping it close to its origin is what makes a
  future upstream fix something that can be read and applied, instead of a
  merge against a tree that was restyled on arrival.
- **It compiles under its own assumptions.** `tsconfig` extends the
  `vendored` preset — bundler module resolution and no
  `noUncheckedIndexedAccess` — because the alternative was rewriting several
  hundred import statements and dozens of index accesses in code we did not
  author. Our own packages keep the stricter defaults.
- **Its tests came with it.** Thirteen suites covering transformers,
  mentions, tables, XML serialization and paste handling run in this
  repository unchanged, which is what makes the port verifiable rather than
  hopeful.
- **It patches two lexical packages.** `@lexical/markdown` (2-space list
  indent) and `@lexical/table` (import behavior) are patched via bun
  `patchedDependencies` at the repo root; the patch files live in
  `patches/`.

## Key exports

- Custom nodes (mentions, equation, image, media, horizontal rule, diff and
  snapshot nodes, …) and `node-list.ts`, which names the node set each
  editor mode registers
- `./transformers` — markdown ↔ node transformers, including the XML forms
  used for structured inline content
- `./utils` — markdown state helpers, mention parsing, diff building
- `plugins/nodeIdPlugin` — assigns the stable per-node id that the CRDT uses
  as its identity key. Load-bearing: without ids, a re-save reads as "every
  node replaced" and the document history becomes useless.
- `decoratorRegistry` / `domFactoryRegistry` — the seams the app fills with
  its own React components (`DecoratorComponent` is deliberately generic;
  the front end narrows it to a React function component, the backend
  registers nothing)

## Testing

`bun run test` in this package runs the vendored vitest suites.
