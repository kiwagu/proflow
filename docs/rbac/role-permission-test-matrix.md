# RBAC role-permission test matrix

This matrix is the planning artifact for section 3 tests in [`docs/cross-functional-checklist.md`](../cross-functional-checklist.md).

It is intentionally limited to regular RBAC behavior:

- role bundles seeded in `roles`, `permissions`, `role_permission`
- effective permission union through `user_role`
- scope boundaries for `space_id` and `organization_id`

Out of scope for this matrix:

- private critical capability / break-glass lifecycle
- UI visibility
- generic space isolation tests that do not exercise RBAC permission bundles

## Columns

| Column | Meaning |
|--------|---------|
| `case_id` | Stable identifier for the scenario |
| `role_set` | One role or a union of roles assigned to the same user |
| `scope_type` | `space` or `organization` |
| `scope_relation` | Relation between the checked resource and the assigned scope |
| `permission_key` | Permission under test |
| `operation` | Human-readable action being validated |
| `expected` | `allow` or `deny` |
| `notes` | Why the expectation exists |

## Seed assumptions

Baseline roles and permissions are currently seeded in:

- [`supabase/migrations/20260404120000_rbac_roles_permissions.sql`](../../supabase/migrations/20260404120000_rbac_roles_permissions.sql)
- [`supabase/migrations/20260405134500_content_items_resource_rls.sql`](../../supabase/migrations/20260405134500_content_items_resource_rls.sql)

Relevant role keys:

- `member`
- `space_admin`
- `org_admin`
- `student`
- `tutor`
- `manager`
- `admin`
- `author`

Relevant permission keys:

- `space.invites.manage`
- `space.members.read`
- `space.members.write`
- `space.users.create`
- `space.users.read`
- `space.users.update`
- `space.users.delete`
- `org.spaces.create`
- `org.spaces.delete`
- `org.members.read`
- `org.members.write`
- `space.content.create`
- `space.content.read`
- `space.content.update`
- `space.content.delete`
- `space.content.publish`
- `space.content.access`
- `space.knowledge.read`
- `space.knowledge.create`
- `space.knowledge.update`
- `space.knowledge.delete`
- `space.knowledge.access`
- `space.knowledge.transition`
- `space.knowledge.approve`

> **`space.content.*` vs `space.knowledge.*`.** `space.content.*` governs the reference
> `content_items` table (the section-4 RLS pattern). The knowledge graph
> (`knowledge_resources`) uses the parallel `space.knowledge.*` family. The role bundles
> are *similar but not identical*: a `member` is a read-only consumer of `content_items`
> but is granted `space.knowledge.create` (knowledge members author their **own** content —
> owner-sovereign). See the role bundles below.
>
> **Scope note (verb possession vs per-resource visibility).** This matrix tests whether a
> role *holds a verb in a space* (capability). Whether a user can read a *specific*
> knowledge resource is a separate, additive decision (visibility floor + per-user/cohort/
> inherited grants + ownership/supervisory branches) made by the RLS access predicate —
> documented in [`docs/knowledge-access-model.md`](../knowledge-access-model.md), not here.
> The two compose: the access predicate uses `space.knowledge.read` (read tier) and
> `space.knowledge.access` (sharing authority) as inputs.

## Matrix

| case_id | role_set | scope_type | scope_relation | permission_key | operation | expected | notes |
|--------|----------|------------|----------------|----------------|-----------|----------|-------|
| `rbac-member-read-space-users` | `member` | `space` | `same_space` | `space.users.read` | read domain users inside assigned space | `allow` | `member` seed grants read only |
| `rbac-member-update-space-users` | `member` | `space` | `same_space` | `space.users.update` | update domain user inside assigned space | `deny` | no write grant for `member` |
| `rbac-member-manage-invites` | `member` | `space` | `same_space` | `space.invites.manage` | create or revoke invite in assigned space | `deny` | no invite permission for `member` |
| `rbac-space-admin-manage-invites` | `space_admin` | `space` | `same_space` | `space.invites.manage` | create or revoke invite in assigned space | `allow` | delegated admin flow |
| `rbac-space-admin-create-space-user` | `space_admin` | `space` | `same_space` | `space.users.create` | create domain user in assigned space | `allow` | seed grants user CRUD to `space_admin` |
| `rbac-space-admin-delete-space-user` | `space_admin` | `space` | `same_space` | `space.users.delete` | delete domain user in assigned space | `allow` | seed grants user CRUD to `space_admin` |
| `rbac-space-admin-cross-space-read` | `space_admin` | `space` | `other_space_same_org` | `space.users.read` | read users in another space of same org | `deny` | space-scoped grant must not leak across spaces |
| `rbac-space-admin-cross-org-read` | `space_admin` | `space` | `other_org` | `space.users.read` | read users in foreign org space | `deny` | strict scope boundary |
| `rbac-org-admin-create-space` | `org_admin` | `organization` | `same_org` | `org.spaces.create` | create space under assigned organization | `allow` | organization-scoped grant |
| `rbac-org-admin-delete-space` | `org_admin` | `organization` | `same_org` | `org.spaces.delete` | delete space under assigned organization | `allow` | organization-scoped grant |
| `rbac-org-admin-read-org-members` | `org_admin` | `organization` | `same_org` | `org.members.read` | read organization membership graph | `allow` | seed grants org membership read |
| `rbac-org-admin-write-org-members` | `org_admin` | `organization` | `same_org` | `org.members.write` | assign or revoke org-scoped roles | `allow` | seed grants org membership write |
| `rbac-org-admin-delegated-space-user-update` | `org_admin` | `organization` | `same_space_under_org` | `space.users.update` | update domain user in any managed space under org | `allow` | org-scoped grant should project into child spaces |
| `rbac-org-admin-cross-org-user-update` | `org_admin` | `organization` | `other_org` | `space.users.update` | update domain user in foreign organization space | `deny` | org-scoped grant must not cross org |
| `rbac-student-read-space-users` | `student` | `space` | `same_space` | `space.users.read` | read domain users in assigned space | `allow` | seed grants read only |
| `rbac-student-update-space-users` | `student` | `space` | `same_space` | `space.users.update` | update domain user in assigned space | `deny` | no write grant for `student` |
| `rbac-tutor-read-space-users` | `tutor` | `space` | `same_space` | `space.users.read` | read domain users in assigned space | `allow` | seed grants read only |
| `rbac-tutor-delete-space-users` | `tutor` | `space` | `same_space` | `space.users.delete` | delete domain user in assigned space | `deny` | no delete grant for `tutor` |
| `rbac-manager-read-space-users` | `manager` | `space` | `same_space` | `space.users.read` | read domain users in assigned space | `allow` | seed grants read only |
| `rbac-manager-write-space-members` | `manager` | `space` | `same_space` | `space.members.write` | mutate membership rows in assigned space | `deny` | no membership write grant for `manager` |
| `rbac-union-member-plus-space-admin` | `member + space_admin` | `space` | `same_space` | `space.invites.manage` | manage invites with multi-role union | `allow` | union semantics should elevate to allowed |
| `rbac-union-student-plus-member-update` | `student + member` | `space` | `same_space` | `space.users.update` | update domain user with two read-only roles | `deny` | union of read-only roles remains deny |
| `rbac-union-org-admin-plus-student-org-scope` | `org_admin + student` | `organization + space` | `same_space_under_org` | `space.users.update` | update domain user inside org-managed space | `allow` | org permission should satisfy check |
| `rbac-no-roles-default-deny` | `none` | `space` | `same_space` | `space.users.read` | read domain users without any assignment | `deny` | deny-by-default contract |
| `rbac-admin-content-create` | `admin` | `space` | `same_space` | `space.content.create` | create content in assigned space | `allow` | admin seed grants full content CRUD |
| `rbac-admin-content-publish` | `admin` | `space` | `same_space` | `space.content.publish` | publish content without moderation | `allow` | admin has unconditional publish right |
| `rbac-admin-content-access` | `admin` | `space` | `same_space` | `space.content.access` | manage content access rules | `allow` | admin manages who can access content |
| `rbac-admin-no-invites` | `admin` | `space` | `same_space` | `space.invites.manage` | create or revoke invite | `deny` | admin is distinct from space_admin; no invite grant |
| `rbac-admin-no-members-write` | `admin` | `space` | `same_space` | `space.members.write` | mutate membership rows | `deny` | admin does not control space membership |
| `rbac-author-content-create` | `author` | `space` | `same_space` | `space.content.create` | create content in assigned space | `allow` | author seed grants create/read/update |
| `rbac-author-content-update` | `author` | `space` | `same_space` | `space.content.update` | update content in assigned space | `allow` | author seed grants create/read/update |
| `rbac-author-no-publish` | `author` | `space` | `same_space` | `space.content.publish` | publish content without moderation | `deny` | author requires admin moderation to publish |
| `rbac-author-no-delete` | `author` | `space` | `same_space` | `space.content.delete` | delete content in assigned space | `deny` | author cannot delete; delete is admin-only |
| `rbac-member-knowledge-create` | `member` | `space` | `same_space` | `space.knowledge.create` | create a knowledge resource | `allow` | knowledge members author their **own** content (owner-sovereign) — diverges from the read-only `content_items` member |
| `rbac-member-knowledge-read` | `member` | `space` | `same_space` | `space.knowledge.read` | read tier for knowledge resources | `allow` | member seed grants read (the verb; per-resource visibility is the access predicate) |
| `rbac-member-knowledge-delete` | `member` | `space` | `same_space` | `space.knowledge.delete` | delete a knowledge resource | `deny` | delete is admin-only |
| `rbac-member-knowledge-access` | `member` | `space` | `same_space` | `space.knowledge.access` | manage knowledge sharing/access rules | `deny` | sharing authority is owner-sovereign OR admin; a member cannot curate others' audiences |
| `rbac-author-knowledge-update` | `author` | `space` | `same_space` | `space.knowledge.update` | update a knowledge resource | `allow` | author bundle = read/create/update/transition |
| `rbac-author-knowledge-no-delete` | `author` | `space` | `same_space` | `space.knowledge.delete` | delete a knowledge resource | `deny` | delete is admin-only (parity with content) |
| `rbac-author-knowledge-no-access` | `author` | `space` | `same_space` | `space.knowledge.access` | manage knowledge access rules | `deny` | `access` (sharing curation) is admin-only |
| `rbac-admin-knowledge-access` | `admin` | `space` | `same_space` | `space.knowledge.access` | share/curate on behalf of any owner | `allow` | admin is the cross-owner curator for **explicit** grants |
| `rbac-admin-knowledge-delete` | `admin` | `space` | `same_space` | `space.knowledge.delete` | delete a knowledge resource | `allow` | admin seed grants full knowledge CRUD |
| `rbac-admin-knowledge-transition` | `admin` | `space` | `same_space` | `space.knowledge.transition` | move a resource through its workflow state | `allow` | admin moderates the publish lifecycle |

## Suggested grouping for implementation

1. `seed contract`
2. `space role allow/deny`
3. `organization role allow/deny`
4. `domain role allow/deny`
5. `multi-role union semantics`
6. `default deny`

## Parametrized groups

Roles with identical permission bundles should collapse to `test.each` in implementation.
The matrix keeps explicit rows as a specification artifact; the test code may deduplicate.

| Group label | Roles | Shared bundle | Suggested test form |
|-------------|-------|---------------|---------------------|
| `domain-read-only` | `student`, `tutor`, `manager` | `space.users.read` only | `test.each(['student', 'tutor', 'manager'])` for both allow and deny cases |

If a future migration diverges any of these roles, split the group back into individual rows and update this table.

## Suggested future file layout

When these tests are implemented, keep RBAC-specific test sources separate from base isolation suites. For example:

- `tests/e2e/src/rbac/`
- `apps/platform/tests/rbac/`

Keep this matrix as the planning source even if concrete test files live elsewhere.
