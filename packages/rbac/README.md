# @workspace/rbac

Shared RBAC helpers for app-layer permission checks that match the Postgres policy model.

## Usage

- Use `hasPermission(supabase, key, scope)` for explicit permission probes.
- Use `canAccessResource(supabase, { permissionKey, spaceId })` for preflight checks before opening a resource route or mutation flow.
- Prefer normal RLS-filtered queries such as `.from('content_items').select(...)` for lists and bulk reads so Postgres performs the filtering server-side.

## Guidance

- Deny by default: missing permission rows, missing membership, or missing RLS policy must all result in no access.
- Prefer list queries over per-row probes when rendering collections; `canAccessResource` is for explicit guards, not N+1 filtering.
- Role changes take effect immediately because access is derived from database state, not copied into static client-side role maps.
