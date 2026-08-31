# `@workspace/package-kinds`

Detection and description of importable learning-package formats
(SCORM, plain HTML bundles) for the document workbench.

## Role in the architecture

A small policy layer on top of `@workspace/domain`: given a
`PackageManifest` (the domain's view of an unzipped upload), it decides
what kind of package it is and how it should be launched.

- `kind.ts` — the `PackageKind` interface (`detect` + `manifest`) and
  entry helpers; kinds are tried in order, the first that claims the
  entries wins.
- `scorm.ts` — SCORM kind: `imsmanifest.xml` parsing and launch entry
  resolution.
- `html-bundle.ts` — plain HTML bundle kind and entry resolution.

No IO here: callers hand in an already-listed manifest; this package
only inspects paths and file contents it is given.

## Testing

`bun run test` runs colocated `*.spec.ts` files via vitest.
