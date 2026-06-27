# Knowledge access model

This document explains how access (read visibility) to knowledge resources is
decided. It is the conceptual companion to the RLS policies in `supabase/migrations/*`
and to the data-ownership rules in [data-ownership-matrix.md](./data-ownership-matrix.md).
The goal is that an outside reader can understand *who can see a knowledge resource and
why* without reading the SQL.

## Principles

- **Fail-closed / private-by-default.** A new resource is born `visibility = 'private'`
  — visible only to its owner. The forgotten case fails **closed** (author forgets to
  share → it stays invisible → recoverable in one click), never open.
- **RLS is the sole authority.** Access is decided by a Postgres predicate inside the
  Row-Level-Security policy, **not** by an application filter such as `where owner = me`.
  The stack exposes direct PostgREST / resolver access that bypasses any UI-side filter,
  so the fence must live in RLS.
- **Additive only.** Sharing is a set of OR'd grants layered on top of a floor; a grant
  only ever **widens** access. Nothing subtracts — there is no "fence" or per-item
  "make this private inside a shared folder" override.
- **Owner-sovereign.** A resource's audience is managed by its owner (or by a space
  curator holding the `space.knowledge.access` capability). A plain member cannot share
  another member's content.
- **Visibility is orthogonal to workflow.** `visibility` (access) is a separate axis
  from `status` (draft / published, a lifecycle state). They are never merged.

## The visibility floor

`visibility` is the single broadcast dial — the lower bound of "who can see this at
all":

| Floor | Who it broadcasts to |
| --- | --- |
| `private` | Owner only (the default). |
| `space` | Every active member of the resource's space who holds the read verb. |
| `organization` | Reserved for organization-wide reads. **Today the read predicate evaluates `space` and `organization` floors identically** — both gate on active membership of the resource's *own* space — so an `organization` floor currently broadcasts to the same audience as `space`. Cross-space, organization-wide reads are a future extension. |

The floor is then **widened** by additive grants (below). The floor never narrows what a
grant confers, and a grant never lowers the floor.

## The access predicate

A single SQL function, `auth_user_can_access_resource(resource, space, owner, visibility,
verb)`, is referenced by every `knowledge_resources` SELECT policy. It returns `true` if
**any** of these disjuncts holds:

| # | Disjunct | Meaning |
| --- | --- | --- |
| 1 | `owner = auth.uid()` | **Intrinsic ownership** — you always see what you own. |
| 2 | space membership + verb **AND** (`visibility ∈ {space, organization}` **OR** cohort grant) | **Broadcast / cohort** — a space member holding `space.knowledge.read` sees the resource when it is on a space/org floor, or when it is shared with a cohort (group) they belong to. |
| 3 | per-user grant | **Direct share** — the resource was granted to you specifically. |
| 4 | inherited grant | **Folder inheritance** — a granted ancestor folder confers read (see below). |
| 5 | manager hierarchy | **Supervisory oversight** — a manager sees a direct report's content (read-only, transparent by design). |

The parentheses in disjunct 2 are normative: the space-membership check sits **inside**
the broadcast/cohort branch, and every grant carries a same-space guard, so no branch can
leak a resource across space boundaries.

## Access matrix

Two views of the same predicate. `✓` = can read, `✗` = cannot.

**A. Broadcast floor, intrinsic, and supervisory reads** (no per-resource grant in
play). "Active space member" means a member of the *resource's* space holding the
`space.knowledge.read` verb.

| Viewer ↓ &nbsp; / &nbsp; Resource floor → | `private` | `space` | `organization` |
| --- | :---: | :---: | :---: |
| **Owner** | ✓ | ✓ | ✓ |
| **Active space member** (read verb) | ✗ | ✓ | ✓ |
| **Member of a *different* space in the org** | ✗ | ✗ | ✗ (reserved) |
| **Non-member / outsider** | ✗ | ✗ | ✗ |
| **The owner's manager** (supervisory) | ✓ | ✓ | ✓ |

**B. Additive grants** — each row is a grant placed on an otherwise-`private` resource;
it only ever *widens* the audience above the floor.

| Grant on the resource | Who additionally gains read |
| --- | --- |
| **Per-user grant** → user `U` | `U` — provided `U` is an active member of the resource's space. |
| **Cohort grant** → group `G` | Every active space member who belongs to `G`. |
| **Folder grant** (a containing folder is shared) | The folder's grantees — but **only** for the folder owner's *own* descendant nodes (owner-scoped spine). A node owned by someone else, nested in that folder, is unaffected. |

Reading the two together: a viewer can read a resource if **any** floor/intrinsic/
supervisory cell in A is `✓` **OR** **any** grant in B that applies to them is present.
Grants never subtract — removing a grant only narrows back to whatever other rows still
admit the viewer.

## Sharing authority — who can grant

Creating or revoking a grant is allowed for the **resource owner OR a holder of
`space.knowledge.access`** (the admin/curator tier). This is symmetric on insert and
delete (whoever may grant may revoke). A plain member cannot share content they do not
own. The admin tier is the cross-owner curator for **explicit** grants only — implicit
inheritance (below) never crosses owners.

## Containment inheritance — "share a folder, share its contents"

Disjunct 4 makes folder sharing intuitive (Explorer / Finder semantics): a node is also
readable if a **granted ancestor folder**, walked up the `contains` forest, confers read
(via a per-user grant, a cohort grant, or a space/organization floor on that ancestor).

- **Owner-scoped.** The ancestor walk climbs a `contains` step **only** where the parent
  folder has the **same owner** as the leaf node being judged. There is no admin /
  cross-owner cascade. This is load-bearing: anyone with `space.knowledge.create` may
  file any node into any folder, so without the same-owner spine a folder share could
  expose a third party's nested node. The same-owner guard makes that impossible —
  sharing a folder can only ever expose the **sharer's own** nested content.
- **Live.** A node newly placed into a granted folder becomes visible immediately, with
  no re-grant. Revoking the folder grant removes the whole subtree's inherited visibility
  live, with no leftover state. Because it is additive, a child that *also* has its own
  grant (or floor, or another granted ancestor) survives the folder's revoke.
- **Floor inherits too.** Dropping a node into a `space`/`organization`-floor folder
  **auto-broadcasts** it to the whole space/org — and since the model is additive-only,
  there is no way to keep that one node private while it sits there. The product
  compensates with a UI hint that names the broadcast scope; "privacy" means not filing
  the node in a broadcast folder.
- **Bounded.** The recursive walk is cycle-safe and depth-bounded, so a malformed
  containment cycle can never hang or over-grant.

## Identity of grantees

A per-user grant targets a specific co-member of the space. Member display name + email
are resolved through a dedicated `SECURITY DEFINER` directory function, which powers the
searchable people-picker in the share dialog (member profile rows are otherwise
own-row-RLS, so without it the UI would only have opaque ids).

## Relationship to RBAC

RBAC and this access model are **layered, not overlapping**:

- **RBAC** decides whether a role *holds a verb in a space at all* — the `space.knowledge.*`
  capability bundle (`read`, `create`, `update`, `delete`, `access`, `transition`,
  `approve`). For example: a `member` holds `read` + `create` (members author their own
  content); only `admin` holds `access` (the sharing/curation authority) and `delete`. The
  role→verb bundles and their allow/deny cases are documented in
  [rbac/role-permission-test-matrix.md](./rbac/role-permission-test-matrix.md).
- **This access model** decides whether a user can read a *specific resource row*, by
  composing those verbs with the visibility floor and the additive grants (the predicate
  above). It *uses* `space.knowledge.read` (the read tier in disjunct 2) and
  `space.knowledge.access` (sharing authority in "who can grant") as inputs.

So "can this role touch knowledge in this space?" is RBAC; "can this user see *this* node?"
is the access predicate. Neither contradicts the other; the predicate is the per-row
refinement of the verb. (The legacy `space.content.*` family in the RBAC matrix governs the
reference `content_items` table, not the knowledge graph.)

## What is *not* access

- **Workflow status** (`draft` / `published`) is a separate lifecycle axis. A document
  can be visible (access) but unpublished (workflow); the two are never conflated.
- **Commercial entitlements** (the `platform.entitlement.*` layer) gate *commercial
  features* (for example an advanced display mode), **not** data access. They are a
  sibling of the RBAC capability map, resolved from the plan on a space/organization —
  never part of the RLS access predicate. A user on a cheaper plan and a user on a richer
  plan have the **same** access to the same data; only optional UI features differ. See
  [feature-management-model.md](./feature-management-model.md).

## Where it is enforced, and how the UI mirrors it

The single authority is the RLS predicate above; every read goes through it under the
user's own database role (no service-role on user read paths). The UI's access indicators
are computed from the **same** logic, so they can never lie — the "badge ≡ panel ≡
predicate" invariant.

On the owner's own browse view, a node shows exactly one of three mutually-exclusive
access-status indicators — a small taxonomy whose only purpose is "at a glance, which of
my things are *for others* vs *only mine*":

| Indicator | State | When (mirrors the predicate) |
| --- | --- | --- |
| **Globe** | **Broadcast** | The node's *effective* floor is `space`/`organization` — its own `visibility`, **or** (floor inheritance) an owner-scoped ancestor folder on a `space`/`organization` floor. The tooltip names the scope; for an inherited broadcast it also names the folder. |
| **People** | **Targeted** | The node is in the owner's outbound-grant set — **per-user OR cohort**, directly OR via a granted ancestor folder — **and** it is not already broadcast (globe takes precedence). The tooltip names the audience. |
| *(none)* | **Private** | Neither broadcast nor granted — the owner's own working content. The absence is the signal; badges draw the eye to the shared exceptions. |

Globe outranks people: a broadcast node is "for everyone in the scope", the widest
audience, so it never also shows a people badge. The badge now covers the full outbound
audience — **per-user ⊕ cohort ⊕ inherited** (an earlier increment marked per-user grants
only; cohort-by-me and the broadcast floor are now included), so the indicator can never
under-state who can see a resource.

The read-only **Access** summary in the details panel is the same mirror, named: it shows
the floor line (Private/Space/Organization), an "Inherited from {folder}" line for an
inherited *grant*, a "Broadcast … via {folder}" line for an inherited *floor* (parallel to
the grant line), and the explicit grantees — per-user **and** cohort — by name in a
bounded list. Audience *management* stays in the dedicated Share dialog; the panel summary
is read-only.
