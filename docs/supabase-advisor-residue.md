# Supabase Security Advisor — accepted residue

The Supabase Security Advisor (splinter) is run after every migration via
`mcp__supabase-self-hosted__get_advisors` (see `create-migration.mdc` →
"Post-apply" close-out). This file records the residue we have **deliberately
accepted** so the close-out review does not keep re-opening it.

> Source of truth is always the live advisor, not this list. Re-run
> `get_advisors({ type: "security" })` after each migration and compare. The
> remediation pass of 2026-06-27 took the count from **168 → 31**; the
> `private`-schema relocation of 2026-06-27 (migrations `…192000` + `…192100`)
> then took it from **31 → ~17** by moving the RLS-internal helpers off the
> PostgREST surface. Every remaining warning is `0029`
> (`authenticated_security_definer_function_executable`).

## What was moved to the `private` schema (no longer residue)

Migrations `20260627192000_move_knowledge_rls_helpers_to_private.sql` and
`20260627192100_move_platform_rls_helpers_to_private.sql` relocated the **14
RLS-INTERNAL** `SECURITY DEFINER` helpers (referenced only by policies / other
functions, **never** called by the app via PostgREST — verified against every
app `.rpc(...)`) into the non-exposed `private` schema. `private` is not in
`PGRST_DB_SCHEMAS` (`public,storage,kb`), so they are no longer REST-reachable;
`authenticated` keeps `EXECUTE` (RLS evaluation needs it) plus `usage` on the
schema, reached only inside RLS / security-definer call chains.

Moved (knowledge): `auth_user_can_access_resource`, `knowledge_resource_user_grant`,
`knowledge_resource_scope_member`, `knowledge_resource_inherited_grant`,
`auth_user_manages_owner`.
Moved (platform): `auth_user_active_in_space`, `auth_user_is_space_admin`,
`auth_user_is_org_admin`, `auth_user_member_of_org`,
`auth_user_can_manage_space_invites`, `role_assignment_is_valid`,
`platform_feature_flag_actor_can_manage_scope`,
`runtime_settings_actor_can_manage_scope`, `runtime_settings_actor_can_read_scope`.

> **Mechanics that made this LOW-blast-radius** (correcting the prior note that
> assumed every policy had to be recreated): `alter function … set schema private`
> **preserves the function OID**, so every RLS policy that references a moved helper
> follows the move automatically — **zero policy edits**. Only function-to-function
> calls needed fixing (callers qualify `public.<helper>`): they were re-pointed to
> `private.<helper>` deterministically from the live `pg_get_functiondef` (see the
> migration DO block), avoiding hand-transcription of large plpgsql bodies. Verified
> by the platform RPC integration suite (vitest 88 + 28) and the full e2e (112).

## The remaining ~17 accepted warnings — all `0029`

These STAY in `public` and remain authenticated-executable **by design**.

### Bucket A — intended public RPCs (the app's own API)

The app calls these over PostgREST under the caller's RLS. They are
`SECURITY DEFINER` because they perform a privileged transactional operation
behind an **internal authorization guard** (the function re-checks the caller's
capability before doing anything). Authenticated-executable is the whole point.

- `rpc_bootstrap_organization_and_space` — onboarding bootstrap (signed-in user)
- `rpc_create_space_invite` / `rpc_revoke_space_invite` / `rpc_accept_space_invite`
- `rpc_set_runtime_setting` / `rpc_delete_runtime_setting`
- `rpc_set_platform_feature_flag` / `rpc_resolve_platform_flag`
- `rpc_*` role administration (`rpc_set_space_member_role`, `rpc_create_*_role`, …)
- `rpc_grant_platform_super_admin` / `rpc_revoke_platform_super_admin`
- `rpc_start_break_glass` / `rpc_end_break_glass`
- `space_member_directory` — powers the co-member picker

### Bucket B′ — DUAL-USE RLS helpers the app also calls by name

Referenced inside `authenticated` RLS policies **and** called by the app via
`.rpc(...)`, so they must stay in the REST-exposed `public` schema. Each returns
only the caller's own access verdict (`auth.uid()`-scoped) or already-visible
data — a direct REST call leaks nothing a normal RLS query would not.

- `auth_user_can_access_in_space`, `auth_user_has_permission`
- `auth_current_user_has_critical_capability`, `auth_user_has_critical_capability`
- `knowledge_user_scope_ids`

## Why we accept the rest instead of driving it to zero

The real exposure — **anon** reach — was closed in the 2026-06-27 pass
(`20260627191100` revokes `EXECUTE` from `anon` on every public
`SECURITY DEFINER` function, and `SELECT` from `anon` on the flagged tables). The
RLS-internal helpers are now off the REST surface (above). What remains is
`authenticated` reach of **Bucket A** (privileged RPCs guarded by an internal
capability re-check) and **Bucket B′** (own-verdict helpers the app calls by
name) — neither closes an exploit, and both must stay REST-reachable to function.

These ~17 are the documented baseline: a new migration should not increase the
count, and any NEW lint of a different kind must be fixed, not absorbed here.

## 2026-07-01 — KB media substrate Phase 0 (ADR-0026): no new residue

Migrations `20260701085100_kb_resource_media_meta.sql` (the `kb.resource_media_meta`
satellite) and `20260701085200_storage_bucket_kb_media.sql` (the private `kb-media`
bucket + four `storage.objects` policies) were applied. `get_advisors({ type:
"security" })` afterward returned **18 lints, ALL `0029`**
(`authenticated_security_definer_function_executable`) — the same pre-existing
Bucket A / Bucket B′ functions listed above, **zero of them new**. The new satellite
has RLS enabled (no `0002`), and the storage policies delegate to the existing
`private.auth_user_can_access_resource` predicate rather than adding any new
`SECURITY DEFINER` surface — so Phase 0 added **no new residue** and introduced **no
new lint kind**. The count sits within the documented `~17` baseline band (RPC count
drifts as features land; the invariant is "no new lint kind, no new residue", which
holds).
