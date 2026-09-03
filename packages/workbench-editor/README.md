# Workbench editor (`@workspace/workbench-editor`)

The document editing shell for the workbench: `DocumentView` (an editor mount
that loads markdown once and tracks read-only state live), `FormatTools`
(selection-driven formatting toolbar), `TableInsert` (grid-picker table
insertion), `Outline` (heading tree with click-to-scroll navigation and
active-heading tracking), and `FindAndReplace` (live search highlighting via
`@lexical/mark`, next/prev stepping, replace-one/replace-all, case toggle).

## Role in the architecture

Host-agnostic UI package one level above `@workspace/lexical-react`: it wires
the editor mount and plugin set into ready-to-drop-in workbench components,
while staying free of routing, data fetching, and app state. All user-facing
strings are injected via label props (`defaultFormatToolsLabels`,
`defaultTableInsertLabels`, `defaultOutlineLabels`,
`defaultFindReplaceLabels`), so hosts localize without forking the
components — the matching `build*Labels(t)` helpers wire each set from the
workbench i18n catalog.

## Commands

```bash
bun run test        # vitest
bun run lint        # eslint (lint:strict for zero warnings)
bun run typecheck   # tsc --noEmit
bun run format      # prettier
```
