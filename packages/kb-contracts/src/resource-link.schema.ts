import { z } from 'zod';

/**
 * KB node satellite `kb.resource_link` (see docs/knowledge-graph-plan.md). The
 * external URL of a `kind=link` node — an ATTRIBUTE of the node, not a graph edge
 * (an edge connects two graph nodes; an external URL is a property). `host` is an
 * optional display host (e.g. "status.acme.com").
 */
export const resourceLinkSchema = z.object({
  node_id: z.string(), // knr_…
  url: z.string().url(),
  host: z.string().nullable().optional(),
});
export type ResourceLink = z.infer<typeof resourceLinkSchema>;

export function parseResourceLink(raw: unknown) {
  return resourceLinkSchema.safeParse(raw);
}
