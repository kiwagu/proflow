# Upstream Documentation Inbox

This directory is a staging area for new upstream documentation batches that need to be adapted into the repository's active rule and skill pyramid.

## Purpose

- Store raw upstream docs before they are mapped into the current rule and skill format.
- Keep raw vendor docs out of the active rule corpus until they are reviewed and adapted.
- Give the agent a stable intake workflow for periodic documentation updates.

## Authoritative Boundary

- Active corpus: `/.cursor/rules/` and `/.agents/skills/`
- Staging only: `docs/upstream-inbox/`

Files in this inbox are not authoritative rules. They are inputs for adaptation.

## Folder Layout

```text
docs/upstream-inbox/
  README.md
  _templates/
    intake-manifest.md
  pending/
    .gitkeep
    2026-04-10-payload-richtext/
      manifest.md
      raw/
      notes/
  processed/
    .gitkeep
  archived/
    .gitkeep
```

## Batch Naming

Create one folder per incoming batch under `pending/`.

Recommended format:

```text
YYYY-MM-DD-source-topic
```

Examples:

- `2026-04-10-payload-lexical`
- `2026-04-10-shadcn-cli`
- `2026-04-10-supabase-realtime`

## Required Files Per Batch

Each batch should contain:

1. `manifest.md`
2. `raw/` with the upstream documents or exports
3. Optional `notes/` for working summaries, diffs, or mapping notes

Use `/_templates/intake-manifest.md` as the manifest starting point.

## Intake Workflow

1. Drop the new upstream docs into `pending/<batch>/raw/`.
2. Copy the manifest template to `pending/<batch>/manifest.md` and fill in source, version, scope, and affected domains.
3. For versioned frameworks, record the installed runtime package and version from the repository before comparing upstream docs.
4. Ask the agent to process that batch through the upstream-doc-intake rule.
5. The agent should:
   - read the raw docs only for the intake task
  - check the repository's installed runtime version first when the docs are version-sensitive
   - map changes onto existing routers and leaves
   - adapt semantics into the repository's current pyramid format
   - avoid copying upstream structure mechanically
   - update smoke-test routes if retrieval paths change
6. When adaptation is complete:
   - move the batch to `processed/` if the raw docs should stay nearby for recent reference
   - move the batch to `archived/` if the integration is complete and the raw docs are no longer needed in active staging

## Retrieval Guardrail

Do not treat `docs/upstream-inbox/` as part of the default active guidance corpus.

Only load this directory when the task is explicitly about:

- upstream doc ingestion
- rule or skill sync with vendor changes
- reconciling a new raw documentation batch with the current pyramid

## Adaptation Rules

When integrating a batch:

1. Prefer updating an existing router or leaf over creating a duplicate document.
2. For version-sensitive frameworks, anchor the sync to the installed runtime version in the repository, not just the newest upstream page.
3. Split only when the new material introduces a new stable concern.
4. Rewrite into project-specific language and retrieval-oriented `description` text.
5. Preserve the pyramid contract: `Pyramid Layer`, `Use This When`, `Stop Here If`, `Descend To`.
6. Update `docs/agent-context-smoke-test.md` whenever routing or retrieval boundaries change.

## Version Alignment Notes

- Payload updates should be reconciled against the installed `payload` and `@payloadcms/*` versions in [apps/author/package.json](../../apps/author/package.json), not against a newer upstream version by default.
- If upstream docs describe a newer runtime than the repository currently runs, keep the active rules aligned with the installed version and record the mismatch in the batch manifest.

## Suggested Batch Status Meanings

- `pending`: raw docs arrived, adaptation not finished
- `processed`: adaptation completed, raw docs kept for short-term traceability
- `archived`: fully integrated, raw batch retained only as historical reference