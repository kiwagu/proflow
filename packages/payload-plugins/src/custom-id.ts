import {
  createEntityId,
  derivePrefixFromSlug,
  ensureUniquePrefix,
  entityIdWithPrefixSchema,
} from '@workspace/entity-id';
import type { Config, CollectionConfig, CollectionSlug, Plugin } from 'payload';

/**
 * A Payload CMS plugin that generates a custom ID for documents in collections.
 *
 * This plugin allows you to specify a prefix for each collection's ID via a `prefixMap`.
 * If no prefix is provided for a collection, it generates one by processing the collection's slug:
 * - Uses `derivePrefixFromSlug` from `@workspace/entity-id`.
 * - Ensures uniqueness across collections with `ensureUniquePrefix`.
 *
 * The generated ID is stored as: `<prefix>_<rand16>.<ts10>`.
 *
 * Note: this ID format is optimized for operator DX and is not time-sortable
 * lexicographically by the whole `id` string; use `createdAt` for ordering.
 *
 * Storage mode:
 * - `{ field: "id" }` writes the generated value into `data.id` (direct id).
 * - `{ field: "publicId" }` writes into `data.publicId`.
 *
 * This plugin guarantees that the ID is unique within each collection via `unique: true`
 * when `field !== "id"` (Payload's native `id` is always unique).
 * This plugin should be used as the last plugin to handle all collections, including those added by other plugins if needed.
 *
 * @param prefixMap - An optional mapping of collection slugs to custom prefixes for their IDs.
 * @returns A function that modifies the Payload config to apply the custom ID logic to collections.
 */
export const customIdPlugin = (
  prefixMap: Partial<Record<CollectionSlug, string>> = {},
  options: Readonly<{
    field?: 'id' | 'publicId';
    /**
     * - "generate": mint an id when missing (default).
     * - "validate": require an id to be provided and validate format/prefix.
     */
    mode?: 'generate' | 'validate';
  }> = {}
): Plugin => {
  return (config: Config) => {
    const field = options.field ?? 'id';
    const mode = options.mode ?? 'generate';

    // Generate a prefix for each collection based on its slug.
    const slugToPrefix: Record<string, string> = {};
    const usedPrefixes = new Set<string>();

    for (const collection of config.collections ?? []) {
      const configured =
        prefixMap[collection.slug as keyof typeof prefixMap] ?? null;

      const basePrefix =
        configured && configured.trim().length > 0
          ? configured
          : derivePrefixFromSlug(collection.slug, { minLen: 3, maxLen: 10 });

      const prefix = ensureUniquePrefix(
        basePrefix,
        collection.slug,
        usedPrefixes,
        { maxLen: 10 }
      );

      usedPrefixes.add(prefix);
      slugToPrefix[collection.slug] = prefix;
    }

    config.collections = (config.collections ?? []).map(
      (collection: CollectionConfig) => ({
        ...collection,
        hooks: {
          ...collection.hooks,
          beforeValidate: [
            ...(collection.hooks?.beforeValidate || []),
            ({
              data,
              operation,
            }: {
              data?: Record<string, unknown> & {
                id?: string | null;
                publicId?: string | null;
              };
              operation?: 'create' | 'update';
            }) => {
              const existing = field === 'id' ? data?.id : data?.publicId;

              const idPrefix = slugToPrefix[collection.slug];
              if (!idPrefix) {
                throw new Error(
                  `customIdPlugin: missing prefix for collection "${collection.slug}".`
                );
              }

              if (mode === 'validate') {
                // On create we require the id to be present and valid.
                if (operation === 'create' && !existing) {
                  throw new Error(
                    `customIdPlugin: missing required ${field} for collection "${collection.slug}".`
                  );
                }
                if (existing) {
                  const checked =
                    entityIdWithPrefixSchema(idPrefix).safeParse(existing);
                  if (!checked.success) {
                    throw new Error(
                      `customIdPlugin: invalid ${field} format for collection "${collection.slug}".`
                    );
                  }
                }
                return data;
              }

              // mode === 'generate': if field is missing, undefined, empty string, or null, generate a new one
              if (!existing) {
                // Remove any existing property to avoid accidental reuse
                const sanitizedData = { ...(data || {}) };
                if (field === 'id') delete sanitizedData.id;
                if (field === 'publicId') delete sanitizedData.publicId;

                const customId = createEntityId(idPrefix);

                return {
                  [field]: customId,
                  ...sanitizedData,
                };
              }

              return data;
            },
          ],
        },
        fields: [
          ...(field === 'id'
            ? collection.fields?.some((f) => 'name' in f && f.name === 'id')
              ? []
              : [
                  {
                    name: 'id',
                    type: 'text',
                    admin: { readOnly: true },
                  } as const,
                ]
            : []),
          ...(field === 'publicId'
            ? collection.fields?.some(
                (f) => 'name' in f && f.name === 'publicId'
              )
              ? []
              : [
                  {
                    name: 'publicId',
                    type: 'text',
                    unique: true,
                    index: true,
                    admin: { readOnly: true },
                  } as const,
                ]
            : []),
          ...(collection.fields || []),
        ],
      })
    );

    return config;
  };
};
