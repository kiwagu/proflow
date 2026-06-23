# Project rules

All rules live in `.cursor/rules/` (single source of truth for Cursor and Claude Code).

## Always-on conventions

@.cursor/rules/execute-dont-delegate.mdc
@.cursor/rules/reset-mode-default.mdc
@.cursor/rules/poc-no-fallbacks.mdc
@.cursor/rules/ai-artifacts-generic-wording.mdc
@.cursor/rules/entity-first-module-naming.mdc
@.cursor/rules/static-imports-only.mdc
@.cursor/rules/text-sorting-centralized.mdc
@.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm-yarn.mdc
@.cursor/rules/domain-context-first-analysis.mdc
@.cursor/rules/process-check-rules-skills.mdc
@.cursor/rules/standard-design-patterns.mdc
@.cursor/rules/zod-schema-first-contracts.mdc
@.cursor/rules/ui-i18n-json-required.mdc

## Architecture & routing

@.cursor/rules/gateway-shell-routing.mdc
@.cursor/rules/platform-centralized-user-management.mdc
@.cursor/rules/monorepo-env-minimalism.mdc
@.cursor/rules/monorepo-new-workspace-scaffold.mdc
@.cursor/rules/notifications-central-email.mdc

## Database & Supabase

@.cursor/rules/db-domain-ids-and-naming.mdc
@.cursor/rules/postgres-sql-style-guide.mdc
@.cursor/rules/create-migration.mdc
@.cursor/rules/create-db-functions.mdc
@.cursor/rules/create-rls-policies.mdc
@.cursor/rules/supabase-identity-sync-author.mdc
@.cursor/rules/supabase-self-hosted-upstream.mdc
@.cursor/rules/use-realtime.mdc
@.cursor/rules/writing-supabase-edge-functions.mdc

## Frontend — Next.js & UI

@.cursor/rules/nextjs-blocking-routes-suspense.mdc
@.cursor/rules/shadcn-patterns-required.mdc
@.cursor/rules/shadcn-patterns-react-ui.mdc

## Payload CMS (Author app)

@.cursor/rules/security-critical.mdc
@.cursor/rules/payload-overview.md
@.cursor/rules/collections.md
@.cursor/rules/access-control.md
@.cursor/rules/access-control-advanced.md
@.cursor/rules/fields.md
@.cursor/rules/field-type-guards.md
@.cursor/rules/hooks.md
@.cursor/rules/queries.md
@.cursor/rules/endpoints.md
@.cursor/rules/adapters.md
@.cursor/rules/components.md
@.cursor/rules/plugin-development.md

## Testing

@.cursor/rules/e2e-required-for-critical-flows.mdc

## Skills

@.agents/skills/e2e-dx-workflow/SKILL.md
@.agents/skills/nextjs-shell-supabase-auth/SKILL.md
@.agents/skills/payload-supabase-gateway-auth/SKILL.md
@.agents/skills/platform-centralized-user-management/SKILL.md
@.agents/skills/shadcn/SKILL.md
