# Feature Management Model

Source of truth for feature-flag ownership, resolution, and admin boundaries.

## Why this is separate from runtime settings

Runtime settings answer questions like log verbosity and locale defaults. Feature flags answer a different question: who is allowed to enable a product capability for which organization and which spaces. Once that ownership model became organization-centric, feature flags no longer fit as just another generic setting row with unconstrained scope overrides.

Prefer one clean model instead of preserving a mixed settings-plus-flags path.

## Scope

This document defines the v1 control model for product feature availability.

It covers:

- ownership of feature activation
- scope semantics across `global`, `organization`, and `space`
- bootstrap behavior for newly created organizations
- UI boundaries for `super-admin`, `org-admin`, and `space-admin`
- audit requirements for mutations

It does not cover:

- billing or entitlements
- experimentation, cohorts, or percentage rollout
- per-user flags
- future platform-wide emergency kill switches beyond the current organization bulk-disable model

## Core principles

1. One typed boolean key per feature.
2. No free-form JSON blob for feature catalogs.
3. No scattered `process.env` checks for product behavior after the runtime provider exists.
4. Organization owns operational rollout after bootstrap.
5. Space can never bypass organization-level disablement.
6. Space-admin gets visibility, not control.
7. All privileged mutations are auditable.

## Current v1 feature catalog

Initial key:

- `platform.feature_flag.organization_settings`

Additional flags should follow the same typed-key pattern.

## Scope semantics

### `global`

- Owner: `super-admin` only.
- Purpose: define the default baseline for newly created organizations.
- Non-goal: day-to-day feature rollout for existing organizations.

### `organization`

- Owners: `org-admin` for the organization and `super-admin`.
- Purpose: operational owner layer for feature rollout.
- Responsibilities: enable or disable a feature across descendant spaces, including bulk deactivation.

### `space`

- Owners: no standalone `space-admin` ownership in v1.
- Purpose: target layer for organization-managed activation or deactivation decisions.
- Constraint: space-level state is valid only inside the boundaries set by the organization layer.

### `user`

- Excluded from feature flags in v1.
- If behavior is truly user-specific, model it as a user preference or entitlement, not as a feature flag.

## Resolution model

1. Platform operators define the default feature baseline at `global` scope.
2. When a new organization is created, its initial feature baseline is seeded from `global`.
3. After bootstrap, that organization owns its ongoing rollout decisions.
4. Organization-level state gates all descendant spaces.
5. Organization operators may activate or deactivate a feature for individual spaces.
6. Organization operators may bulk deactivate a feature for all spaces in the organization.
7. If the organization layer disables the feature, no space may re-enable it locally.

## Role matrix

| Role / scope | Read effective state | Change global default | Change organization rollout | Change per-space availability |
|--------------|----------------------|-----------------------|-----------------------------|-------------------------------|
| `super-admin` | Yes | Yes | Yes | Yes |
| `org-admin` | Yes | No | Yes, for own organization | Yes, for spaces in own organization |
| `space-admin` | Yes, for active space | No | No | No |

## UI boundaries

- `super-admin` may manage platform defaults and may operate on behalf of an organization through the super-admin contour.
- `org-admin` is the primary operator for day-to-day rollout inside the organization.
- `space-admin` should see effective feature state and resolution source, but should not get write controls by default.
- Runtime settings UI and feature-management UI may share implementation primitives, but they should not collapse into one ambiguous ownership surface.

## Audit requirements

Every feature mutation must capture:

- actor
- feature key
- target organization
- target space when applicable
- previous value
- new value
- timestamp
- request or correlation identifier when available

## Implementation guidance

- Prefer one current resolution path.
- Treat this document as the checklist-linked source of truth for feature rollout behavior until a stronger ADR or package-level contract supersedes it.

## Deferred topics

- Billing-driven entitlements
- Platform-wide emergency kill switch separate from organization bulk disable
- Cohort rollout or gradual exposure
- Per-user flags