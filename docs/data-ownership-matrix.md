# Data ownership matrix

This matrix defines who is allowed to write each cross-app entity and which apps are mirrors only.

| Entity | Authoritative writer(s) | Mirror / read-only consumers | Notes |
| --- | --- | --- | --- |
| `auth.users` | Platform auth flows, Supabase Auth pipeline | Author, future shells | Never written from downstream app UIs. |
| `public.profiles` | Identity sync pipeline, Platform-owned lifecycle flows | Author, future shells | Canonical Postgres mirror of auth identity. |
| `public.organizations` | Platform bootstrap and org-admin flows | Author read-only, future shells | Domain structure, not identity. |
| `public.spaces` | Platform org-admin flows | Author read-only, future shells | Always scoped beneath one organization. |
| `public.organization_memberships` | Platform-owned admin flows and trusted fanout logic | Future shells read-only | Centralized membership authority. |
| `public.space_memberships` | Platform-owned admin flows and trusted fanout logic | Author read-only unless an explicit scoped workflow is added later | RLS governs visibility; write path stays centralized. |
| `public.user_role` | Platform org-admin and privileged operator flows | Author read-only | Single RBAC assignment source of truth. |
| `public.space_invites` | Platform server actions / RPC | Notification workers, read-only shells | Invite lifecycle may fan out side effects, but creation authority stays in Platform. |
| `public.content_items` | RLS-guarded space-scoped server flows | Author and future shells inside active-space scope | Reference pattern for section 4 resource tables. |
| `public.scopes` | RLS-guarded space-scoped server flows with `space.content.access` | Author and future shells inside active-space scope | Scoped grouping layer under each `space_id`. |
| `public.scope_memberships` | RLS-guarded space-scoped server flows with `space.content.access` | Author and future shells inside active-space scope | Join table linking users to scopes. |
| `public.content_item_scopes` | RLS-guarded space-scoped server flows with `space.content.access` | Author and future shells inside active-space scope | Join table linking resources to scopes (same-space invariant). |
| `public.space_admin_audit_log` | Trusted SQL triggers and privileged server-side workflows | Platform operators, actor self | Append-only audit boundary. |

## Governance rules

- Identity entities are written only by Platform-owned auth or sync paths.
- Domain memberships and RBAC assignments are written only by Platform-owned privileged flows.
- Space-scoped resources may be written by domain apps, but only through validated server boundaries and RLS-protected queries.
- Mirrors may enrich UX or cache state, but they must not become a second source of truth.