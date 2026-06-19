import { z } from 'zod';

/**
 * KB node satellite `kb.resource_media_meta` (see docs/knowledge-graph-plan.md).
 * Kind-specific media attributes for `file`/`video` nodes: byte size, duration
 * and mime type. The form is ready even before real binary upload lands (that is
 * a later slice owned by the author app); this slice carries the attribute shape.
 */
export const resourceMediaMetaSchema = z.object({
  node_id: z.string(), // knr_…
  byte_size: z.number().int().min(0).nullable().optional(),
  duration_ms: z.number().int().min(0).nullable().optional(),
  mime_type: z.string().nullable().optional(),
});
export type ResourceMediaMeta = z.infer<typeof resourceMediaMetaSchema>;

export function parseResourceMediaMeta(raw: unknown) {
  return resourceMediaMetaSchema.safeParse(raw);
}
