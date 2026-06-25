import type { Floor } from '../engine/http.js';

/**
 * The DICTIONARY model — a declarative description of reference content addressed
 * by stable `ref` strings. The materializer walks it through the `/author/graph/*`
 * endpoints and returns `ref → nodeId`, so the demo database and the e2e specs
 * name the very same nodes. New features extend this vocabulary, never the
 * imperative seed code.
 */

/** A logical participant; resolved to a concrete user by the materializer. */
export type ActorRef = string;
/** A stable node handle, unique within a scenario (e.g. `drive/handbook`). */
export type NodeRef = string;
/** A stable cohort handle, unique within a scenario. */
export type ScopeRef = string;

/** Role a scenario actor is granted in the space. */
export type ActorRole = 'admin' | 'member' | 'space_admin';

export type ActorSpec = {
  ref: ActorRef;
  /** Defaults to `admin` (base read holds; the access DIMENSION is the subject). */
  role?: ActorRole;
};

export type ScopeSpec = {
  ref: ScopeRef;
  name: string;
  /** Actor refs enrolled as members of this cohort. */
  members?: ActorRef[];
};

export type ReportingLine = {
  manager: ActorRef;
  subordinate: ActorRef;
};

/** Common fields shared by every node kind. */
type NodeBase = {
  ref: NodeRef;
  title: string;
  description?: string;
  /** Owner actor ref; defaults to the scenario's primary actor (`admin`). */
  owner?: ActorRef;
  /** Floor visibility; omit for private-by-default. */
  visibility?: Floor;
  /** Cohort refs this node is shared into (additive grants). */
  scopes?: ScopeRef[];
  /** Tag titles to attach via `tagged` edges (tag nodes are deduped by title). */
  tags?: string[];
  /** Pin the node in the OWNER's "Starred" lens (per-user; the owner needs the
   * `space.knowledge.progress` verb — `admin`/`author`, not `member`). */
  starred?: boolean;
  /** Pin the node for these specific actors (each must be able to SEE it and hold
   * `space.knowledge.progress`) — e.g. star a doc someone else shared with you. */
  starredBy?: ActorRef[];
  /** Record a per-user "open" for these actors (verb `space.knowledge.open`) so the
   * node lands in their "Recent" lens (ADR-0016). The actor must be able to SEE it. */
  openedBy?: ActorRef[];
};

export type FolderNode = NodeBase & {
  kind: 'folder';
  children?: SeedNode[];
};

export type TextNode = NodeBase & {
  kind: 'text';
  /** Lexical body (build via `prose`/`lexicalDoc`); omit for an empty body. */
  body?: unknown;
  /** Leave the body UNPUBLISHED (a draft). Text docs are published by default so
   * read mode shows them; set this on the few nodes that demo the draft state. */
  draft?: boolean;
  /** Additional published body states applied after the initial one (each a Lexical
   * doc) — every entry is a new published version, so the reader shows a version
   * history (ADR-0012). Only meaningful for a published (non-draft) doc. */
  revisions?: unknown[];
  /** Workflow status; when set, the node is authored via the owner's RLS client
   * (the create endpoints do not expose `status`) and carries no Payload body. */
  status?: string;
  /** Workflow definition key (pairs with `status` for board/gating demos). */
  workflowKey?: string;
};

export type BodylessNode = NodeBase & {
  kind: 'link' | 'file' | 'video';
};

export type SeedNode = FolderNode | TextNode | BodylessNode;

export type ContainEdge = { folder: NodeRef; child: NodeRef };
export type ShortcutEdge = { folder: NodeRef; target: NodeRef };

/**
 * A typed relation edge authored directly via the owner's RLS client — for
 * relations the `/author/graph/edges` endpoint does not expose (e.g.
 * `prerequisite`), exactly as the e2e seeders author them.
 */
export type RelationEdge = {
  from: NodeRef;
  to: NodeRef;
  relation: string;
  position?: number;
};

/** A saved projection over the scenario's graph (KB grid / board / …). */
export type ProjectionSeed = {
  ref: string;
  appType: 'knowledge_base';
  name: string;
  view: string;
  /** Built from a tag ref's node id at materialize time, or a static spec. */
  spec: (refs: ReadonlyMap<string, string>) => unknown;
  owner?: ActorRef;
};

export type SeedScenario = {
  id: string;
  title: string;
  /** One-line capability the scenario demonstrates — the self-documentation. */
  summary: string;
  /** Presets that include this scenario (besides the implicit `all`). */
  presets: string[];
  actors?: ActorSpec[];
  scopes?: ScopeSpec[];
  reportingLines?: ReportingLine[];
  tree: SeedNode[];
  /** Extra containment beyond the tree (multi-parent / cross-folder filing). */
  contains?: ContainEdge[];
  shortcuts?: ShortcutEdge[];
  /** Typed relation edges authored via the owner's RLS client (e.g. prerequisite). */
  edges?: RelationEdge[];
  projections?: ProjectionSeed[];
  /** Node refs to soft-delete after creation (demonstrates the Trash lifecycle). */
  trash?: NodeRef[];
};
