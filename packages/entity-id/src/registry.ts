import {
  CANONICAL_ENTITY_ID_RE,
  defineEntityPrefixes,
  type EntityIdOf,
  type EntityIdRegistry,
  type EntityIdSchema,
  prefixGatedEntityIdSchema,
  withSchemas,
} from 'entity-id';
import { z } from 'zod';

/**
 * Central catalog of every entity-id prefix in the system — one prefix per
 * kind, each unique and well-formed.
 *
 * Single source of truth for the prefix that goes into `<prefix>_<rand16>.<ts10>`
 * across all three producers: Postgres column defaults
 * (`entity_id_generate('<prefix>')`), the Payload custom-id plugin's `prefixMap`,
 * and app-side minting through {@link entityIdRegistry}.
 *
 * The keys are stable semantic entity names (not table names) so renaming a table
 * does not churn this file; the values are the wire prefixes and MUST match the DB.
 */
export const ENTITY_PREFIXES = {
  // Identity & platform tenancy
  user: 'usr',
  organization: 'org',
  space: 'spc',
  spaceInvite: 'spi',
  spaceAdminAuditLog: 'sal',

  // RBAC
  role: 'rol',
  permission: 'prm',
  userRole: 'url',

  // Operator critical-capability JIT (private schema)
  operatorCapabilityGrant: 'ocg',
  operatorCapabilitySession: 'ocs',
  operatorCapabilityAudit: 'oca',

  // Legacy content + scoping
  contentItem: 'cnt',
  scope: 'scp',

  // Platform infrastructure
  outboxJob: 'out',
  runtimeSetting: 'rts',

  // Knowledge graph core
  knowledgeResource: 'knr',
  knowledgeEdge: 'kne',
  projection: 'prj',
  resourceUserState: 'rus',
  reportingLine: 'rpl',

  // Knowledge-base satellites (kb schema)
  kbResourceDescription: 'krd',
  kbResourceActivity: 'kra',
  kbResourceLink: 'krl',
  kbMediaBlob: 'kmb',
  kbResourceMediaMeta: 'kmm',

  // Payload (Author app) documents
  body: 'bod',

  // Local-first document workbench (ported domain layer)
  /** A native document: the CRDT and everything derived from it. */
  document: 'doc',
  /** A named version of a document — a frontier, not a snapshot. */
  documentVersion: 'ver',
  /** One embedded passage of a document, in the search index. */
  documentChunk: 'chk',
  /** A node of the file tree: a folder, a document, or a blob-backed file. */
  fileNode: 'fil',
  /** A chat conversation. */
  chat: 'cht',
  /** One message in a chat. */
  chatMessage: 'msg',
  /** One part of an assistant turn — text, a tool call, reasoning. */
  chatMessagePart: 'prt',
  /** One streaming run of the model, so an interrupted turn stays representable. */
  chatStream: 'stm',
  /**
   * A writing client: each tab and the agent worker mint one for the life of
   * the instance, and sign their saves with it.
   */
  writer: 'wrt',
} as const satisfies Record<string, string>;

/**
 * The registry, declared once through the published package: it validates the
 * catalog eagerly (a malformed prefix or two kinds sharing one throws at import
 * time) and derives one typed factory per kind —
 * `entityIdRegistry.factories.spaceIdFactory.create()` mints a `SpaceId`.
 *
 * Its guards (`factories.*.is` / `assert`, `kindOf`, `assertKnown`) follow the
 * package's process-wide validation mode, whose default checks only the
 * `<prefix>_` head. Nothing in the repo sets the mode; where full depth matters,
 * pass `{ mode: 'full' }` per call or parse with
 * {@link canonicalEntityIdSchemaFor}.
 */
export const entityIdRegistry: EntityIdRegistry<typeof ENTITY_PREFIXES> =
  defineEntityPrefixes(ENTITY_PREFIXES);

/** Semantic entity name — a key of {@link ENTITY_PREFIXES}. */
export type EntityKind = keyof typeof ENTITY_PREFIXES;

/** A registered wire prefix — a value of {@link ENTITY_PREFIXES}. */
export type EntityPrefix = (typeof ENTITY_PREFIXES)[EntityKind];

/**
 * The package's zod members per kind: `entityIdSchemas.space.prefixSchema` is
 * the prefix gate the contracts use (a `spc_` head, any suffix — mode
 * independent). Its `.schema` follows the ambient validation mode; for the
 * full contract use {@link canonicalEntityIdSchemaFor}.
 */
export const entityIdSchemas = withSchemas(entityIdRegistry);

/**
 * The schema for a key already stored — an id read back from the server:
 * the whole `<prefix>_<rand16>.<ts10>` contract, of this kind, in canonical
 * lowercase, exactly as it arrives. Whatever the package's validation mode.
 *
 * Nothing is trimmed or lower-cased. A stored key in another spelling is a
 * different key: rewriting it would merge two rows that differ only in case
 * into one, or send a later write to a key the server does not hold. So it
 * is refused. Ids the client mints are canonical already; ids typed in by
 * someone are normalized with the package's `strictEntityIdSchema` /
 * `normalizeEntityId` before they are stored.
 *
 * The package has no per-kind schema of this depth: its per-kind `schema`
 * checks only the prefix head under the default mode.
 */
export function canonicalEntityIdSchemaFor<K extends EntityKind>(
  kind: K
): EntityIdSchema<K> {
  return z
    .string()
    .regex(CANONICAL_ENTITY_ID_RE, {
      message: 'Not a canonical "<prefix>_<rand16>.<ts10>" entity id',
    })
    .pipe(prefixGatedEntityIdSchema<K>(ENTITY_PREFIXES[kind]));
}

type Ids = typeof ENTITY_PREFIXES;

export type UserId = EntityIdOf<Ids, 'user'>;
export type OrganizationId = EntityIdOf<Ids, 'organization'>;
export type SpaceId = EntityIdOf<Ids, 'space'>;
export type SpaceInviteId = EntityIdOf<Ids, 'spaceInvite'>;
export type SpaceAdminAuditLogId = EntityIdOf<Ids, 'spaceAdminAuditLog'>;
export type RoleId = EntityIdOf<Ids, 'role'>;
export type PermissionId = EntityIdOf<Ids, 'permission'>;
export type UserRoleId = EntityIdOf<Ids, 'userRole'>;
export type OperatorCapabilityGrantId = EntityIdOf<
  Ids,
  'operatorCapabilityGrant'
>;
export type OperatorCapabilitySessionId = EntityIdOf<
  Ids,
  'operatorCapabilitySession'
>;
export type OperatorCapabilityAuditId = EntityIdOf<
  Ids,
  'operatorCapabilityAudit'
>;
export type ContentItemId = EntityIdOf<Ids, 'contentItem'>;
export type ScopeId = EntityIdOf<Ids, 'scope'>;
export type OutboxJobId = EntityIdOf<Ids, 'outboxJob'>;
export type RuntimeSettingId = EntityIdOf<Ids, 'runtimeSetting'>;
export type KnowledgeResourceId = EntityIdOf<Ids, 'knowledgeResource'>;
export type KnowledgeEdgeId = EntityIdOf<Ids, 'knowledgeEdge'>;
export type ProjectionId = EntityIdOf<Ids, 'projection'>;
export type ResourceUserStateId = EntityIdOf<Ids, 'resourceUserState'>;
export type ReportingLineId = EntityIdOf<Ids, 'reportingLine'>;
export type KbResourceDescriptionId = EntityIdOf<Ids, 'kbResourceDescription'>;
export type KbResourceActivityId = EntityIdOf<Ids, 'kbResourceActivity'>;
export type KbResourceLinkId = EntityIdOf<Ids, 'kbResourceLink'>;
export type KbMediaBlobId = EntityIdOf<Ids, 'kbMediaBlob'>;
export type KbResourceMediaMetaId = EntityIdOf<Ids, 'kbResourceMediaMeta'>;
export type BodyId = EntityIdOf<Ids, 'body'>;
export type DocumentId = EntityIdOf<Ids, 'document'>;
export type DocumentVersionId = EntityIdOf<Ids, 'documentVersion'>;
export type DocumentChunkId = EntityIdOf<Ids, 'documentChunk'>;
export type FileNodeId = EntityIdOf<Ids, 'fileNode'>;
export type ChatId = EntityIdOf<Ids, 'chat'>;
export type ChatMessageId = EntityIdOf<Ids, 'chatMessage'>;
export type ChatMessagePartId = EntityIdOf<Ids, 'chatMessagePart'>;
export type ChatStreamId = EntityIdOf<Ids, 'chatStream'>;
export type WriterId = EntityIdOf<Ids, 'writer'>;
