/**
 * Presentation-side data types for the `/author/graph/*` render surface. These
 * shapes ride ALONGSIDE the frozen `ProjectionResult` contract (schema_version=1)
 * — the KB satellite attributes, node meta, and the containment/shortcut forests
 * are needed only by the card surfaces, so they are loaded as presentation
 * fan-outs rather than extending the contract.
 *
 * Extracted as TYPE-ONLY definitions (no server imports) so a client view can
 * consume them without dragging the server data loaders into the client bundle.
 */

/**
 * One `contains` edge (folder → child) as the Drive view reads it. `from` is the
 * container folder, `to` the child node (FORWARD per ADR-0015).
 */
export type ContainmentEdge = {
  from: string; // knr_… of the folder
  to: string; // knr_… of the child (folder or content node)
  position: number;
};

/**
 * One `shortcut` edge (folder → target) as the Drive view reads it (ADR-0015 §3).
 * FORWARD direction `from`=folder, `to`=target. A cross-folder symlink: rendered
 * ONLY in Drive, EXCLUDED from containment traversal, so it never forms a cycle.
 */
export type ShortcutEdge = {
  from: string; // knr_… of the source folder
  to: string; // knr_… of the target (folder or content node)
  position: number;
};

/** KB application attributes of ONE node, as the Drive cards read them. */
export type KbAttributes = {
  /** RAG-bound description text (editable, stored). Absent → never set. */
  description?: string;
  /** Provenance source of the node. Absent → defaults to human in the view. */
  provenance?: 'human' | 'imported' | 'ai';
  /** External URL + host for `kind=link`. */
  link?: { url: string; host: string | null };
  /**
   * Real media satellite (`kb.resource_media_meta`, ADR-0026) for `kind=file|video`
   * — present ONLY when the node has confirmed bytes (a `kmm` row), absent otherwise
   * (poc-no-fallbacks: no mock fill). The card meta line reads `byteSize`/`durationMs`/
   * `mimeType`; the ResourcePanel Media section additionally needs `storagePath` (echoed
   * on download-authorize) + `originalFilename` (the display name, never the storage
   * path). `byteSize` mirrors the satellite `size_bytes`.
   */
  media?: {
    byteSize: number | null;
    durationMs: number | null;
    mimeType: string | null;
    /** `spaces/<spaceId>/kb/<nodeId>/<serverKey>` — the object the download URL signs. */
    storagePath: string;
    /** The display filename (satellite `original_filename`); NEVER the storage path. */
    originalFilename: string;
  };
  /** Real view counter (server-incremented on open). */
  viewCount?: number;
};

/**
 * One tag node (`kind='tag'`) as the cards / panel / facet read it — id + title
 * only. ADR-0003 Variant B: a tag IS an ordinary node, and "resource R has tag T"
 * is a directed `tagged` edge (from=R → to=T) — there is NO tag table or column, so
 * a tag surfaces here purely as a node projection, never a scalar field. Loaded as a
 * presentation fan-out (`loadResourceTagsForItems` per item; `loadSpaceTags` for the
 * whole space) alongside the resolved canvas, never extending the frozen
 * `ProjectionResult` contract.
 */
export type ResourceTag = {
  id: string;
  title: string;
};

/** Node owner + timestamp the Drive meta line needs but the FROZEN
 * `ProjectionResultItem` contract does not carry (`schema_version`=1). The "Recent"
 * filter sorts by the PER-USER `last_opened_at` overlay (loaded separately). */
export type NodeMeta = {
  ownerUserId: string | null;
  /** Last MODIFICATION (cross-store: node row + body + satellite + edge, EXCLUDING
   * mere views), maintained by the recency roll-up (ADR-0016). Drives the "Modified"
   * column — distinct from the node row's raw `updated_at`, which misses body/satellite
   * edits, and from `last_activity_at`, which also counts opens. */
  lastModifiedAt: string;
  /**
   * The node's BROADCAST FLOOR (`knowledge_resources.visibility`, ADR-0017 §1.5) — the
   * single per-resource dial: private / space / organization. Read alongside the rest of
   * the node row (no extra query). Drives the ResourcePanel's read-only "Access" floor
   * line (ADR-0023 §7b) — the read-side mirror of the ShareDialog's floor selector. A
   * DISPLAY read of an already-RLS-admitted row, never a fence. */
  visibility: ResourceFloor;
};

/**
 * The CURRENT user's space-level knowledge verbs, resolved ONCE per space (the
 * verdict is constant across every node in the space — `auth_user_can_access_in_space`
 * is space+verb, never per-node). The `⋯` node-actions menu combines these with
 * per-node ownership to DISPLAY-GATE its items (ADR-0006: gating = display). This is
 * fail-SAFE UX, NEVER the security boundary — Postgres RLS remains the sole authority;
 * hiding an item the user cannot perform only spares them a silent no-op route hit.
 *
 * Mirrors the `knowledge_resources` write/delete RLS predicate exactly:
 *   canModify(node) = node.ownerUserId === me || canUpdate
 *   canDelete(node) = node.ownerUserId === me || canDelete
 *   canCreate       = canCreate            (New-subfolder)
 * (there are NO per-node write grants — cohort/per-user grants only widen the SELECT
 * visibility fence, never the update/delete USING — so the space verb is the whole
 * non-owner capability). */
export type SpaceCapabilities = {
  canUpdate: boolean;
  canDelete: boolean;
  canCreate: boolean;
  /**
   * `space.knowledge.access` — the audience-management verb (ADR-0017 §3 D9).
   * Server-derived, mirrors the §3 RLS share authority EXACTLY: a non-owner who
   * holds it may share another member's content (cohort link + per-user grant +
   * floor change). Combined with per-node ownership into the Share entry's
   * `canShare = owned || canAccess` (ADR-0019 §4) — display courtesy, never the
   * fence; RLS re-checks every share route. */
  canAccess: boolean;
};

/**
 * The CURRENT space's COMMERCIAL entitlements (ADR-0022) — a plan-derived signal,
 * resolved ONCE per space server-side from the platform `runtime_settings` registry
 * (global→org→space, org∧space AND-composition), NOT from RLS verbs. An entitlement
 * answers "does this space's PLAN include the capability"; a `SpaceCapabilities` verb
 * answers "is this user PERMITTED to act". They are DIFFERENT authorities (commercial
 * plan vs RLS) — kept ORTHOGONAL: `entitlements` rides as a SIBLING of `capabilities`
 * on `KbViewData`, never merged into the verb namespace (Fork 1).
 *
 * This is a DISPLAY gate, never a security boundary (ADR-0022 Fork 2): the advanced
 * (structural) view renders EXACTLY the same RLS-visible node-set as the flat view —
 * only the layout differs. A forged `advancedStructuralView` leaks nothing (RLS is
 * untouched); the worst case is a cosmetic upsell-bypass. Fail-CLOSED `false` on any
 * resolve error (fail-to-cheapest-plan).
 */
export type SpaceEntitlements = {
  /**
   * `platform.entitlement.advanced_structural_view` — the advanced (structural /
   * KB-containment-tree) display of the STRUCTURAL lenses (the two Shared lenses +
   * Starred + Trash; ADR-0022 Addendum A) is included in this space's plan. ONE generic
   * commercial unit, lens-agnostic. `false` = the cheaper plan: the Flat/Advanced toggle
   * renders DISABLED + upsell hint, and the server forces the lens flat even if
   * `?view=advanced` is hand-edited.
   */
  advancedStructuralView: boolean;
};

/** One cohort scope of the space + whether THIS node is fenced to it. Drives the
 * panel's "who can see it" section (cohort/scope visibility). */
export type ScopeChoice = {
  id: string;
  name: string;
  linked: boolean;
};

/** Broadcast floor (the `knowledge_resources.visibility` enum) — the single
 * per-resource dial: private (owner + supervisory) / space / organization
 * (ADR-0017 §1.5). Cohort grants compose additively on top. */
export type ResourceFloor = 'private' | 'space' | 'organization';

/** One per-user grant on a node (ADR-0019) — a person this resource is shared with,
 * with a display label resolved from the co-member directory (ADR-0020). `email` is the
 * secondary disambiguator line; null only for the vanishingly-rare missing-profile row.
 * Drives the Share dialog's "who has access" per-person rows. */
export type UserGrant = {
  userId: string;
  displayName: string;
  email: string | null;
  grantedBy: string;
};

/** One grantable space member for the Share dialog's people-picker (ADR-0019 Fork 2):
 * an active member of the resource's space, already filtered of the owner and the
 * already-granted set. `displayName` + `email` are resolved via the co-member directory
 * (ADR-0020); `email` is the secondary disambiguator line. The list is a UX convenience,
 * never the fence. */
export type GrantableMember = {
  userId: string;
  displayName: string;
  email: string | null;
};

/**
 * One audience entry of a "Shared by me" resource (ADR-0021 Part B / ADR-0023 §7) — a
 * single party the CURRENT user has shared the resource OUT to. Two `kind`s, merged into
 * one ordered list so the people-badge + the panel grantee list cover BOTH dimensions:
 *  - `'user'`   — a per-user grant (`knowledge_resource_user_grants`): one co-member,
 *                 labelled via the co-member directory (ADR-0020); `userId` is their id.
 *  - `'cohort'` — a cohort grant (`knowledge_resource_scopes`): a group, labelled by the
 *                 scope name; `userId` holds the `scope_id` (a stable unique React key in
 *                 the merged list) and `email` is null (a group has no single address).
 *
 * `email` is the secondary disambiguator line for a person; null for a cohort.
 */
export type ShareAudience = {
  /** Discriminator — a single co-member (`user`) or a whole cohort/group (`cohort`). */
  kind: 'user' | 'cohort';
  /** The grantee's user_id (`user`) OR the scope_id (`cohort`) — unique within the list. */
  userId: string;
  /** Member display name (`user`) OR the cohort/group name (`cohort`). */
  displayName: string;
  /** Member email (`user`) — the secondary line; null for a cohort. */
  email: string | null;
};

/**
 * One entry of the "Shared by me" lens (ADR-0021 Part B, extended for cohort-by-me per
 * ADR-0023 §7) — ONE resource the CURRENT user has shared OUT, paired with the AUDIENCE
 * they granted it to. A read-only projection over the outbound grants I created — both
 * per-user (`knowledge_resource_user_grants WHERE granted_by = me`) AND cohort
 * (`knowledge_resource_scopes WHERE linked_by = me`) — joined to the resources I can
 * still SEE (RLS the fence): a resource I can no longer see — or whose only grant I
 * revoked — never appears (fail-closed by construction). `granted_by`/`linked_by = me`
 * are FILTERS (which grants I created), never the fence.
 *
 * - `resourceId` — the shared resource's `knr_…` id. The render agent INTERSECTS the
 *   set of these ids with the resolved canvas (lens = canvas ∩ {ids I granted}).
 * - `grantees` — the audience (per-user grantees + cohorts) I granted it to, sorted by
 *   display name (canonical `@workspace/std` text sort). Each carries a `kind` so the
 *   panel can render a person vs a group; people via the co-member directory (ADR-0020),
 *   cohorts by scope name.
 */
export type SharedByMeEntry = {
  resourceId: string;
  grantees: ShareAudience[];
};

/**
 * The mechanism that grants the CURRENT user access to a node in the "Shared with me"
 * lens (ADR-0021 Part C). The `'shared'` lens is "visible nodes I do NOT own" — but the
 * resolver (frozen, `security invoker`, ADR-0003) returns visible nodes WITHOUT saying
 * WHICH additive grant admits me. This re-derives the reason from the already-visible
 * set, purely as DISPLAY ENRICHMENT (never a fence — the node is already visible; we
 * only label why). The three mechanisms, in precedence order (most deliberate first):
 *
 *   - `personal`  — a per-user grant TO me (`knowledge_resource_user_grants`, ADR-0019):
 *                   someone chose me specifically. The strongest signal.
 *   - `cohort`    — a cohort grant (`knowledge_resource_scopes`, ADR-0017 §1.5) to a
 *                   cohort I belong to: shared with a group I'm in.
 *   - `broadcast` — the residual: visible via the space/org floor OR supervisory
 *                   hierarchy (`auth_user_manages_owner`). For v1, supervisory FOLDS
 *                   into broadcast (a subordinate's content I can see is not a
 *                   deliberate share TO me either — ADR-0021 §7 DEFERRED note); a later
 *                   layer MAY split a "Via your team" mechanism.
 *
 * Precedence is `personal > cohort > broadcast` — a node admitted by several mechanisms
 * (e.g. granted to me personally AND space-published) reports the most deliberate one as
 * its WINNING mechanism.
 */
export type ShareMechanism = 'personal' | 'cohort' | 'broadcast';

/**
 * The "Shared with me" mechanism annotation (ADR-0021 Part C) — a map from a shared
 * node id to the WINNING mechanism that grants the current user access (precedence
 * `personal > cohort > broadcast`). Computed by ONE batched fanout
 * (`annotateShareMechanism`) over the shared-set node ids: three IN-list reads
 * (per-user grant / cohort membership / residual), NEVER per-node and NEVER N+1.
 *
 * This is enrichment over an ALREADY-RLS-admitted set: a node not visible to the user
 * is never in the input, so it can never be annotated — the annotation can only
 * describe access the user already has, never grant or narrow it (Invariant #1: a
 * read-only projection, no new table, no resolver change, no new access dimension).
 *
 * Every node in the shared set HAS an entry: if a node is matched by neither a personal
 * grant nor a cohort I belong to, it is `broadcast` by construction (it is visible, so
 * SOME mechanism admits it; the residual is the floor/supervisory branch).
 */
export type ShareMechanismByItem = Record<string, ShareMechanism>;

/**
 * ONE page of the grantable-member picker (ADR-0021 Part A). The directory function pages
 * a keyset cursor over the stable order and reports the TOTAL of grantable matches for the
 * query (owner + already-granted already removed server-side), so the picker can show a
 * small page of REAL candidates plus a "+N more" remaining-count.
 *
 * - `items` — this page's grantable members, in the directory's own (stable) order.
 * - `nextCursor` — an OPAQUE token to fetch the next page; `null` when this is the last
 *   page (no more rows). The client treats it as opaque and re-sends it as `cursor`.
 * - `total` — the total count of grantable matches for the current query (across all
 *   pages), so the picker shows `total − shown` remaining.
 */
export type GrantableMembersPage = {
  items: GrantableMember[];
  nextCursor: string | null;
  total: number;
};
