# Agent Context Smoke Test

Use this checklist after editing rules or skills to confirm the pyramid-chain still routes prompts into the narrowest relevant docs.

## How To Use

1. Start from `/.cursor/rules/process-check-rules-skills.mdc`.
2. For each prompt below, verify the first router choice and the final leaf choice.
3. If the agent loads broad sibling docs instead of the listed leaf, tighten the relevant `description`, `Use This When`, or `Descend To` text.

## Routing Cases

| Prompt | Expected route |
| --- | --- |
| Figure out where to start analyzing a feature and separate domain, application, and infrastructure concerns | process -> domain-context-first-analysis |
| Define a contract so the runtime schema and static type come from one source of truth | process -> zod-schema-first-contracts |
| Rewrite a rule or skill so it does not depend on the current project name | process -> ai-artifacts-generic-wording |
| Add a custom Payload admin logo | process -> payload overview -> components -> components-slots-and-overrides -> components-root-and-resource-slots |
| Wire a new Payload custom field component and fix importMap resolution | process -> payload overview -> components -> components-registration-and-boundaries -> components-paths-and-import-map |
| Debug a Payload admin component that uses hooks and translations | process -> payload overview -> components -> components-runtime-and-styling -> components-admin-hooks-and-data-access |
| Restrict records to active enterprise subscribers | process -> payload overview -> access-control -> access-control-advanced -> access-control-context-and-subscription-patterns -> access-control-subscription-patterns |
| Extract reusable access helpers for org-scoped collections | process -> payload overview -> access-control -> access-control-advanced -> access-control-factories-and-templates |
| Speed up a slow Payload access rule in list view | process -> payload overview -> access-control -> access-control-advanced -> access-control-performance-and-debugging |
| Add a new closed Next.js shell behind gateway auth | process -> nextjs-shell-supabase-auth skill |
| Fix auth bridging for Payload admin behind the public gateway | process -> payload-supabase-gateway-auth skill |
| Keep Author as a read-only mirror instead of a second user-management control plane | process -> platform-centralized-user-management skill |
| Mirror Supabase Auth user lifecycle events into Author over JetStream instead of app-specific HTTP fan-out | process -> platform-centralized-user-management skill -> supabase-identity-sync-author |
| Add a guest-accessible shell path without duplicating `path.startsWith` checks | process -> gateway-shell-routing |
| Fix a `blocking-route` error caused by async auth reads in a protected shell page | process -> nextjs-shell-supabase-auth skill -> nextjs-blocking-routes-suspense |
| Decide whether a critical user flow requires E2E coverage | process -> e2e-required-for-critical-flows -> e2e-dx-workflow |
| Add a translated UI label and update the catalog | process -> ui-i18n-json-required |
| Send a new outbound invite email without adding app-local SMTP code | process -> notifications-central-email |
| Integrate a fresh upstream Payload or shadcn doc batch from the inbox into the current pyramid | process -> upstream-doc-intake |
| Check which shadcn base, icon library, aliases, and docs flow apply in the current project | process -> shadcn skill -> project-context-selection-and-docs |
| Safely update an installed shadcn component while preserving local changes | process -> shadcn skill -> workflow-and-updating |
| Use shadcn form primitives for a validated settings form with grouped controls | process -> shadcn skill -> forms rules -> forms-layout-validation-and-groups |
| Add an input with an inline action button or a small segmented choice control | process -> shadcn skill -> forms rules -> forms-input-groups-and-choice-controls |
| Change shadcn theme tokens or preset-level styling | process -> shadcn skill -> customization -> customization-theme-variables-and-presets |
| Add a new component variant or a wrapper component without forking the whole design system | process -> shadcn skill -> customization -> customization-component-overrides-and-updates |
| Preview what a shadcn component install would change before applying it | process -> shadcn skill -> cli -> cli-init-add-and-preview |
| Browse or inspect a shadcn registry through MCP instead of direct CLI commands | process -> shadcn skill -> mcp |
| Resolve docs URLs or inspect registry item details through the shadcn CLI | process -> shadcn skill -> cli -> cli-registry-and-docs |
| Switch a shadcn preset after checking project config and merge strategy | process -> shadcn skill -> cli -> cli-project-info-build-and-presets |
| Fix a Dialog trigger API mismatch between `base` and `radix` primitives | process -> shadcn skill -> primitive differences -> base-vs-radix-trigger-composition |
| Fix a Select placeholder or object-value mismatch between `base` and `radix` primitives | process -> shadcn skill -> primitive differences -> base-vs-radix-select |
| Fix a ToggleGroup or Accordion single-vs-multiple value mismatch between `base` and `radix` primitives | process -> shadcn skill -> primitive differences -> base-vs-radix-stateful-controls |
| Replace ad-hoc overlay or card markup with the canonical shadcn composition patterns | process -> shadcn skill -> composition rules -> composition-overlays-and-structure |
| Replace custom empty states, callouts, or status placeholders with canonical shadcn feedback components | process -> shadcn skill -> composition rules -> composition-feedback-empty-and-utilities |
| Fix icon placement in a Button without hardcoded sizing classes | process -> shadcn skill -> icons rules |
| Replace raw status colors and ad-hoc variant classes with semantic tokens and built-in variants | process -> shadcn skill -> styling rules -> styling-semantic-tokens-and-variants |
| Replace manual `space-y-*`, `dark:` overrides, or overlay z-index hacks with canonical shadcn styling rules | process -> shadcn skill -> styling rules -> styling-layout-utilities-and-stacking |
| Add a localized rich text field with constrained Lexical features | process -> payload overview -> fields -> fields-editorial-and-simple-types |
| Constrain a field-level Lexical editor to the root editor's allowed features | process -> payload overview -> fields -> fields-editorial-and-simple-types |
| Model a blocks-based page builder with relationships and media | process -> payload overview -> fields -> fields-relational-and-structured-types |
| Add conditional field visibility and custom validation to a field | process -> payload overview -> fields -> fields-validation-and-dynamic-behavior |
| Perform a Local API write on behalf of a user and keep hook-side nested writes atomic | process -> payload overview -> security-critical |
| Decide whether a custom admin component should stay server-side or become client-side | process -> payload overview -> components -> components-registration-and-boundaries -> components-server-client-boundaries-and-types |
| Override a field edit surface and keep custom props serializable | process -> payload overview -> components -> components-slots-and-overrides -> components-field-slots-and-props |
| Style a Payload admin component and debug why it does not load | process -> payload overview -> components -> components-runtime-and-styling -> components-styling-performance-and-troubleshooting |
| Restrict content by locale or publish window | process -> payload overview -> access-control -> access-control-advanced -> access-control-context-and-subscription-patterns -> access-control-context-and-time-patterns |
| Create a new space-scoped table with required `space_id`, timestamps, and entity-id primary key | process -> space-scoped-resource-tables |
| Choose SQL object names and an entity-id prefix for a new domain table | process -> db-domain-ids-and-naming |
| Wire a private room channel subscription with cleanup in React | process -> use-realtime -> realtime-topology-and-client-patterns |
| Add a broadcast trigger and RLS policy for realtime room messages | process -> use-realtime -> realtime-database-broadcast-and-authorization |
| Migrate an old `postgres_changes` listener to broadcast | process -> use-realtime -> realtime-operations-and-migration |
| Implement a Supabase Edge Function with `Deno.serve` and shared helpers | process -> writing-supabase-edge-functions |
| Add a plugin that injects fields into selected collections | process -> payload overview -> plugin-development -> plugin-architecture-and-config-mutation |
| Add plugin hooks and dashboard admin components | process -> payload overview -> plugin-development -> plugin-extension-surfaces |
| Implement plugin disable behavior and safe onInit seeding | process -> payload overview -> plugin-development -> plugin-lifecycle-and-safety |
| Build a nested `where` clause with `and`/`or` operators | process -> payload overview -> queries -> query-operators-and-where-patterns |
| Query Payload Local API on behalf of a user with access enforced | process -> payload overview -> queries -> local-api-and-access-behavior |
| Pass a Local API context flag into hooks while enforcing access and document locks | process -> payload overview -> queries -> local-api-and-access-behavior |
| Translate a Payload query into REST or GraphQL and reduce over-fetching | process -> payload overview -> queries -> query-transports-and-performance |
| Create a timestamped Supabase migration file with lowercase SQL and explicit RLS commentary | process -> db-domain-ids-and-naming -> create-migration |
| Write a `security invoker` Postgres function with explicit `search_path` and qualified names | process -> db-domain-ids-and-naming -> create-db-functions |
| Write a select policy for authenticated users with correct `to` and `using` clauses | process -> space-scoped-resource-tables -> create-rls-policies -> rls-policy-authoring-basics |
| Gate a policy on team membership from JWT app metadata | process -> space-scoped-resource-tables -> create-rls-policies -> rls-helper-functions-and-jwt |
| Speed up a slow RLS policy that joins to membership tables | process -> space-scoped-resource-tables -> create-rls-policies -> rls-performance-patterns |
| Add a custom endpoint that reads route params and checks `req.user` | process -> payload overview -> endpoints -> endpoints-request-and-auth-patterns |
| Fix a custom endpoint where `req.locale` is undefined until request locales are added manually | process -> payload overview -> endpoints -> endpoints-request-and-auth-patterns |
| Decide whether a new endpoint belongs on a collection or root config | process -> payload overview -> endpoints -> endpoints-placement-and-routing |
| Expose a top-level health check that must bypass the configured Payload API subpath | process -> payload overview -> endpoints -> endpoints-placement-and-routing |
| Add CORS headers and consistent API errors to a custom endpoint | process -> payload overview -> endpoints -> endpoints-errors-cors-and-responses |
| Implement published-or-authenticated collection access with owner updates | process -> payload overview -> access-control -> access-control-collection-patterns |
| Add roles to the auth collection and enforce tenant-scoped field access | process -> payload overview -> access-control -> access-control-field-rbac-and-tenant-patterns |
| Configure Payload Postgres adapter and preserve nested transaction context | process -> payload overview -> adapters -> adapters-database-and-transactions |
| Add S3-backed media storage or swap email delivery adapter | process -> payload overview -> adapters -> adapters-storage-and-email |
| Pick the right guard before traversing nested Payload fields | process -> payload overview -> field-type-guards -> field-guard-primitives-and-capabilities |
| Recursively traverse only data-bearing fields | process -> payload overview -> field-type-guards -> field-guard-traversal-and-patterns |
| Choose between beforeChange and afterChange for a collection hook | process -> payload overview -> hooks -> hooks-lifecycle-patterns |
| Change collection operation arguments before Payload starts the hook lifecycle | process -> payload overview -> hooks -> hooks-lifecycle-patterns |
| Share expensive work through hook context and revalidate paths safely | process -> payload overview -> hooks -> hooks-context-and-side-effects |
| Create a standard auth collection with roles in JWT | process -> payload overview -> collections -> collections-core-and-auth-patterns |
| Configure media uploads, drafts, or a singleton global | process -> payload overview -> collections -> collections-media-drafts-and-globals |

## Failure Signals

- The agent keeps broad Payload docs in context after the exact leaf is obvious.
- A feature-analysis prompt jumps straight into a framework or transport leaf without first establishing the bounded context and domain source of truth.
- A contract-definition prompt suggests parallel handwritten TypeScript types and Zod schemas for the same exported boundary object.
- An AI-artifact edit introduces branded project names in titles, examples, or explanations where a generic phrase would work.
- A prompt about component registration lands in runtime/styling guidance.
- A prompt about server-vs-client component boundaries lands in slot guidance.
- A prompt about access factories lands in context/time/subscription guidance.
- A subscription prompt lands in locale/time guidance.
- A shell-auth prompt routes into general gateway routing instead of the dedicated workflow skill.
- A user-lifecycle prompt lands in Payload auth bridge guidance instead of platform-centralized-user-management.
- A guest-path routing prompt lands in shell-auth setup guidance instead of gateway-shell-routing.
- An outbound email prompt lands in app-local SMTP or generic env guidance instead of notifications-central-email.
- An upstream-doc sync prompt lands in a domain rule directly instead of upstream-doc-intake and the inbox workflow.
- A shadcn project-context or docs-flow prompt stops at the root skill instead of descending to project-context-selection-and-docs.
- A shadcn update-or-merge prompt stops at the root skill or jumps straight to raw CLI commands instead of workflow-and-updating.
- A validated form-layout prompt stops at the forms router or lands in generic styling/composition guidance.
- An input-group or small choice-control prompt lands in layout/validation guidance instead of the controls leaf.
- A shadcn CLI preview prompt stops at the CLI router instead of descending to init/add/preview guidance.
- A shadcn CLI docs or registry-detail prompt lands in MCP or install-preview guidance.
- A shadcn preset-switch prompt lands in generic customization guidance instead of the CLI preset workflow.
- A shadcn MCP registry prompt lands in CLI guidance.
- A theme-variable or preset prompt lands in component-override guidance instead of the theme leaf.
- A component-variant or wrapper prompt lands in generic styling or theme-variable guidance.
- A trigger API mismatch prompt stays at the primitive router instead of descending to trigger-composition guidance.
- A `Select` API mismatch prompt lands in generic primitive guidance instead of the select leaf.
- A ToggleGroup or Accordion value-shape prompt lands in generic primitive guidance instead of stateful-controls.
- An overlay/card composition prompt lands in feedback or utility guidance.
- An empty-state or toast prompt lands in overlay/card structure guidance.
- An icon-contract prompt lands in generic styling guidance.
- A semantic-token or variant prompt lands in layout-utility guidance.
- A spacing or z-index prompt lands in semantic-token guidance.
- A shell `blocking-route` prompt stays in shell setup guidance instead of descending to nextjs-blocking-routes-suspense.
- An identity mirror transport prompt stays at ownership policy and never descends to supabase-identity-sync-author.
- A field-validation prompt lands in relational field guidance.
- A privileged Local API write prompt lands in generic query guidance instead of security-critical.
- A space-scoped table prompt lands in generic naming guidance without the required table-shape contract.
- A realtime migration prompt lands in client setup guidance.
- An Edge Function prompt lands in Next.js or generic server guidance instead of writing-supabase-edge-functions.
- A plugin lifecycle prompt lands in extension-surface guidance.
- A Local API access prompt lands in generic query-operator guidance.
- A migration prompt lands directly in RLS/function guidance instead of the database entry rule plus `create-migration`.
- An RLS prompt skips the database entry rule and jumps straight to an SQL leaf.
- An RLS performance prompt lands in authoring-syntax guidance.
- An endpoint placement prompt lands in request-body guidance.
- A tenant RBAC prompt lands in collection-level access guidance.
- A storage-adapter prompt lands in transaction guidance.
- A hook-context prompt lands in generic lifecycle guidance.
- A `beforeOperation` prompt lands in context guidance instead of lifecycle selection.
- A root-level endpoint prompt lands in request-body guidance instead of placement.
- A custom-endpoint locale prompt lands in generic response guidance instead of request/auth patterns.
- A Local API lock/context prompt lands in generic transport guidance.
- A field-level Lexical feature prompt lands in relational or validation field guidance.
- A draft/global prompt lands in core collection guidance.

## Repair Order

1. Tighten the leaf `description` first.
2. Then tighten `Use This When` in the router.
3. Then remove ambiguous sibling links from `Descend To` if needed.