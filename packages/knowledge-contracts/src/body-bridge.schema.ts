import { entityIds } from '@workspace/entity-id';
import { z } from 'zod';

/**
 * Node↔body bridge domain events (ADR-0002 §1, slice-03 §2.2). A `kind=text`
 * knowledge node (authoritative, in Postgres) and its Lexical body (in Payload/
 * Mongo) are linked two-ways; these events carry the reconcilable intent across
 * the storage seam. Same shape as `@workspace/domain-events` `identity-lifecycle`
 * (discriminatedUnion on `event` + a pinned `schema_version` literal), so the
 * synchronous POC fan-out and a future durable JetStream consumer parse the
 * identical envelope — the async consumer is a seamless swap.
 *
 * `body.linked`   — a body was created/attached to a node (the node got a
 *                   `body_ref`). The reconciler re-links a node missing it.
 * `body.unlinked` — a body was detached (node deleted / no longer kind=text);
 *                   the reconciler removes the orphaned Payload doc.
 *
 * Only these two events exist in this slice; `body.updated` is deliberately
 * absent — body versions are Payload-internal and the node does not care.
 */

export const BODY_BRIDGE_EVENTS = ['body.linked', 'body.unlinked'] as const;
export type BodyBridgeEventName = (typeof BODY_BRIDGE_EVENTS)[number];

export const BODY_BRIDGE_SCHEMA_VERSION = 1 as const;

/** Thin body pointer — the SAME shape as `knowledge_resources.body_ref`. */
export const bodyRefSchema = z.object({
  collection: z.literal('bodies'),
  doc_id: z.string(), // opaque Payload-internal doc id (NOT a bod_ entity id)
});
export type BodyRef = z.infer<typeof bodyRefSchema>;

const envelopeBase = {
  schema_version: z.literal(BODY_BRIDGE_SCHEMA_VERSION),
  space_id: entityIds.space.prefixSchema,
  node_id: entityIds.knowledgeResource.prefixSchema, // knr_… — the authoritative node
};

export const bodyBridgeEnvelopeSchema = z.discriminatedUnion('event', [
  z.object({
    ...envelopeBase,
    event: z.literal('body.linked'),
    body_ref: bodyRefSchema,
  }),
  z.object({
    ...envelopeBase,
    event: z.literal('body.unlinked'),
  }),
]);
export type BodyBridgeEnvelope = z.infer<typeof bodyBridgeEnvelopeSchema>;

export function parseBodyBridgeEnvelope(raw: unknown) {
  return bodyBridgeEnvelopeSchema.safeParse(raw);
}
