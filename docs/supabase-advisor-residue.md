# Supabase Security Advisor — accepted residue

The Supabase Security Advisor (splinter) is run after every migration via
`mcp__supabase-self-hosted__get_advisors` (see `create-migration.mdc` →
"Post-apply" close-out). This file records the residue we have **deliberately
accepted** so the close-out review does not keep re-opening it.

> Source of truth is always the live advisor, not this list. Re-run
> `get_advisors({ type: "security" })` after each migration and compare. The
> remediation pass of 2026-06-27 took the count from **168 → 31**.

## The 31 accepted warnings — all `authenticated_security_definer_function_executable`

Every remaining warning is the same lint (`0029`): a `SECURITY DEFINER`
function in the PostgREST-exposed `public` schema that the `authenticated` role
can call via `/rest/v1/rpc/...`. They fall into two by-design buckets.

### Bucket A — intended public RPCs (the app's own API)

The app calls these over PostgREST under the caller's RLS. They are
`SECURITY DEFINER` because they perform a privileged transactional operation
behind an **internal authorization guard** (the function re-checks the caller's
capability before doing anything). Authenticated-executable is the whole point.

- `rpc_bootstrap_organization_and_space` — onboarding bootstrap (signed-in user)
- `rpc_create_space_invite` / `rpc_revoke_space_invite` / `rpc_accept_space_invite`
- `rpc_set_runtime_setting` / `rpc_delete_runtime_setting`
- `rpc_set_platform_feature_flag`
- `rpc_resolve_platform_flag` — entitlement/feature-flag resolve
- `rpc_grant_platform_super_admin` / `rpc_revoke_platform_super_admin`
- `rpc_start_break_glass` / `rpc_end_break_glass`
- `space_member_directory` — powers the co-member picker

### Bucket B — internal RLS-helper predicates

These are referenced **inside `authenticated` RLS policies** (so the
`authenticated` role must retain `EXECUTE`, or policy evaluation breaks). They
are `SECURITY DEFINER` so they can read the membership/role tables the policy
needs. Crucially, each returns only the **caller's own access verdict**
(`auth.uid()`-scoped boolean) or data the caller can already see — a direct REST
call leaks nothing a normal RLS-governed query would not already return.

- `auth_user_can_access_resource`, `auth_user_can_access_in_space`,
  `auth_user_has_permission`, `auth_user_active_in_space`
- `auth_user_is_space_admin`, `auth_user_is_org_admin`, `auth_user_member_of_org`,
  `auth_user_manages_owner`, `auth_user_can_manage_space_invites`
- `auth_current_user_has_critical_capability`, `auth_user_has_critical_capability`
- `knowledge_resource_user_grant`, `knowledge_resource_scope_member`,
  `knowledge_resource_inherited_grant`, `knowledge_user_scope_ids`
- `role_assignment_is_valid`
- `platform_feature_flag_actor_can_manage_scope`,
  `runtime_settings_actor_can_manage_scope`, `runtime_settings_actor_can_read_scope`

## Why we accept Bucket B instead of driving it to zero

The real exposure — **anon** (unauthenticated) reach — was closed in the
2026-06-27 pass (`20260627191100` revokes `EXECUTE` from `anon` on every public
`SECURITY DEFINER` function, and `SELECT` from `anon` on the flagged tables).
What remains is `authenticated` reach, which:

1. closes **no exploit** — these return only the caller's own verdict / already
   visible data; and
2. would cost a **high-blast-radius migration** to silence: the only way to keep
   them callable inside RLS while hiding them from PostgREST is to move them to a
   non-exposed schema (`private`) and **recreate every policy that references
   them** — `auth_user_can_access_in_space` alone appears in ~44 policies,
   `auth_current_user_has_critical_capability` in ~30.

So the `private`-move is a **deferred, optional purity pass**, not a security
fix. If undertaken, it must recreate all referencing policies and be verified by
the full access e2e matrix. Until then, these 31 are the documented baseline:
a new migration should not increase the count, and any NEW lint of a different
kind must be fixed, not absorbed here.
