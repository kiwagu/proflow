# Identity vs domain boundary

This document defines which operations belong to centralized identity management and which belong to space-scoped domain administration.

## Decision rule

If an operation changes who a person is in the system, how they authenticate, or whether the account exists at all, it is an identity operation. If it changes what that authenticated person can do inside an organization or space, it is a domain operation.

## Operation matrix

| Operation | Layer | Authority | Notes |
| --- | --- | --- | --- |
| Create auth account | Identity | Platform / auth pipeline | Never managed from Author or other mirrors. |
| Update auth email or password | Identity | Platform / Supabase Auth | Downstream apps mirror only. |
| Delete account | Identity | Platform / auth pipeline | Domain rows must follow FK policy and lifecycle cleanup. |
| Mirror profile row | Identity | Identity sync pipeline | `public.profiles` remains the canonical user mirror in Postgres. |
| Create organization | Domain | Platform bootstrap flow | Emits org + first space + role assignments. |
| Create space | Domain | Platform org-admin flow | Scoped beneath one organization. |
| Add space membership | Domain | Platform / RBAC-guarded server flow | Must remain inside authorized org/space scope. |
| Assign org or space role | Domain | Platform / RBAC-guarded server flow | Uses `user_role` assignments, not ad-hoc flags. |
| Read resource in space | Domain | RLS + RBAC helper | Enforced by `space_id` and permission checks. |
| Mutate resource in space | Domain | RLS + RBAC helper | Deny by default when policy or permission is missing. |
| Archive content or materials | Domain | Space-scoped app flow | Must stay within active space. |
| Change global break-glass capability | Identity/security-critical | Platform only | Audit required. |

## Write path

Memberships are written only through Platform-owned server actions or RPCs using trusted server context. User-role assignments are written only through Platform-admin or org-admin flows guarded by RBAC checks. Space-scoped resources should be written through RLS-protected Supabase access, with server-side validation before mutation and permission checks aligned with `space_id`.

Postgres remains the consistency boundary. Read-after-write expectations assume standard single-region Postgres semantics: after a committed transaction, subsequent reads in the same environment should observe the new state.

## Cascade chain

The current domain model already cascades user removal through the core join tables:

- `space_memberships.user_id -> auth.users(id) on delete cascade`
- `organization_memberships.user_id -> auth.users(id) on delete cascade`
- `user_role.user_id -> auth.users(id) on delete cascade`

For space-scoped resources, distinguish mutable ownership from immutable attribution. `owner_user_id` may use `references auth.users (id) on delete set null` when reassignment and offboarding should preserve the row. By contrast, creator-attribution fields such as `created_by` or invite-style `created_by_user_id` may intentionally store the historical user UUID without a foreign key so the actor identity remains recoverable even after the auth account is deleted.

## Platform authority vs mirrors

Platform is the only operator-facing authority for user lifecycle. Author and any future shells may mirror user identity or expose read-only/support views, but they must not become a second source of truth for account CRUD.

## Resource taxonomy

Section 4 resource tables should use one consistent shape even when the product names differ.

| Resource class | Examples | Required fields | Typical permissions |
| --- | --- | --- | --- |
| `document` | content item, lesson draft, SOP | `id`, `space_id`, `owner_user_id`, `created_by`, `status`, `visibility`, timestamps | `space.<entity>.create/read/update/delete/publish` |
| `asset` | media object, attachment, image pack | `id`, `space_id`, `owner_user_id`, `created_by`, `status`, `visibility`, timestamps | `space.<entity>.create/read/update/delete` |
| `dataset` | imported roster, reporting snapshot | `id`, `space_id`, `owner_user_id`, `created_by`, `status`, timestamps | `space.<entity>.create/read/update/delete` |
| `deliverable` | submission bundle, generated package | `id`, `space_id`, `owner_user_id`, `created_by`, `status`, `visibility`, timestamps | `space.<entity>.read/update/delete` |

Default lifecycle is `draft` → `active` → `archived` → `deleted`.

| Lifecycle transition | Required permission |
| --- | --- |
| create → `draft` | `space.<entity>.create` |
| read active or archived item | `space.<entity>.read` |
| edit title, metadata, ownership | `space.<entity>.update` |
| publish to wider audience | `space.<entity>.publish` |
| soft-delete or remove | `space.<entity>.delete` |

RLS should remain the final enforcement layer. Application code may preflight with typed helpers, but unsupported transitions must still be blocked by policy.

Scope-based access joins are represented by `public.scopes`, `public.scope_memberships`, and `public.content_item_scopes`, with same-space invariants enforced in Postgres.

## Ownership and offboarding

`owner_user_id` may default to `on delete set null` for space-scoped resources when the row must survive offboarding. `created_by` is different: for audit-heavy or attribution-heavy domains, prefer preserving the original UUID value even after user deletion instead of nulling it out through a foreign key action.

Ownership transfer is allowed only through explicit server-side workflows:

- `org_admin` may transfer ownership inside organizations they administer.
- `space_admin` may transfer ownership only inside the active space and only when the product flow explicitly exposes that action.
- Break-glass operators may correct ownership when normal scope or lifecycle rules block recovery.

Every ownership or scope-link change must emit an audit row. If a resource requires a non-null owner for business reasons, the application layer should block destructive offboarding until ownership is reassigned; the database default still remains `set null` so identity deletion never cascades through unrelated domain content.

## Related guidance

- Platform centralized user management: `.agents/skills/platform-centralized-user-management/SKILL.md`
- Space isolation and active space rules: `docs/cross-functional-checklist.md`
- RBAC helpers and permission keys: `packages/rbac/src`